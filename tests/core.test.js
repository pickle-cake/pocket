const test = require('node:test'), assert = require('node:assert/strict');
const { loadCore, plain } = require('./helpers');
const c = loadCore(['parseStrokes', 'parseExerciseLine', 'parseRoutine', 'resolveExercises', 'buildPlan', 'builderApply',
  'graceSlot', 'OnsetDetector', 'patKey', 'parseSig', 'textKey', 'nearestSlot', 'analyseCheck', 'strokeRate', 'masteryTier', 'MTIER', 'RATE_AT', 'badgeValues', 'newSum', 'runScore', 'runMax', 'winMult', 'highScores', 'unpackStrokes', 'BADGES', 'maxPoints', 'tempoMult', 'scoreParts', 'runShare', 'bestShares', 'scoreBreakdown', 'streakAfter', 'clockStep', 'clockVerdict']);

const runPoints = (codes, lv) => c.scoreParts([[codes, 1]], lv);
const plan = (text, opt) => {
  const p = c.parseRoutine(text);
  const ex = c.resolveExercises(p.exercises, { unit: 'pass', v: 1 }, { bpm: 60, subdiv: 4 });
  return { p, ex, plan: c.buildPlan(ex, Object.assign({ gapBeats: 0, clickMode: 'strokes', dyn: null }, opt)) };
};

test('strokes, groups and rests', () => {
  const r = c.parseStrokes('RLRL _ LR', 4);
  assert.deepEqual(plain(r.notes), ['R', 'L', 'R', 'L', '_', 'L', 'R']);
  assert.equal(r.strokes, 6);
});

test('note codes set the subdivision until the next code', () => {
  const r = c.parseStrokes('8 RL 16 RLRL', 4);
  assert.deepEqual(plain(r.subs), [2, 2, 4, 4, 4, 4]);
});

test('unknown characters are refused with a message', () => {
  assert.match(c.parseStrokes('RLX', 4).err, /only L, R/);
});

test('flams and drags: f and d go in front of a stroke', () => {
  assert.deepEqual(plain(c.parseStrokes('fR fL dR dL', 4).notes), ['fR', 'fL', 'dR', 'dL']);
  assert.deepEqual(plain(c.parseStrokes('FR dl', 4).notes), ['fR', 'dL']);
  for (const bad of ['f', 'fR f', 'f R', 'd_', 'fRd'])
    assert.match(c.parseStrokes(bad, 4).err, /flam/, bad);
});

test('a flam is a different exercise from the plain stroke', () => {
  const k = x => c.textKey(x, 4);
  assert.notEqual(k('RLRL RLRL'), k('fRLRL RLRL'));
});

test('time signatures: bar groups and the count-in', () => {
  const s = c.parseSig('7/8 (3+2+2)');
  assert.deepEqual(plain(s.sig.groups), [3, 2, 2]);
  assert.match(c.parseSig('7/8 (3+2)').err, /add up/);
  assert.match(c.parseSig('7/3').err, /2, 4 or 8/);
});

test('routine text: title, each, passes and tempo', () => {
  const p = c.parseRoutine('title: Warm up\neach: x4\nRLRL RLRL  x8\nLRLR LRLR @90\n# a note');
  assert.equal(p.title, 'Warm up');
  assert.equal(p.errors.length, 0);
  assert.equal(p.exercises.length, 2);
  assert.deepEqual(plain(p.exercises[0].dur), { unit: 'pass', v: 8 });
  assert.equal(p.exercises[1].bpm, 90);
});

test('an exercise that does not fill its bar gets a warning', () => {
  const p = c.parseRoutine('time: 7/8\nRLRLRL');
  assert.ok(p.errors.some(e => /holds/.test(e)));
});

test('plan: one slot per stroke, none for rests, and grace flags', () => {
  const { plan: pl } = plan('16 fR _ L dR');
  assert.equal(pl.slots.length, 3);
  assert.deepEqual(plain(pl.slots.map(s => s.gr)), [1, 0, 2]);
});

test('graceSlot finds a flam only just before its main stroke', () => {
  const { plan: pl } = plan('8 R fL R L');
  const s = pl.slots, t = s[1].t;
  assert.equal(c.graceSlot(s, t - 0.04, 0), 1);
  assert.equal(c.graceSlot(s, t - 0.005, 0), -1);
  assert.equal(c.graceSlot(s, t - 0.2, 0), -1);
  assert.equal(c.graceSlot(s, t - 0.04, 2), -1);
});

test('builder taps edit the text', () => {
  assert.equal(c.builderApply('R ', 'fL'), 'R fL');
  assert.equal(c.builderApply('RfL', 'back'), 'R');
  assert.equal(c.builderApply('RLfR', 'swap'), 'LRfL');
  assert.equal(c.builderApply('RL', 'code:8'), 'RL 8 ');
});

/* A stick strike: a noisy burst that fades in a few milliseconds. */
function detect(flam, gap, graceAmp, mainAmp) {
  const sr = 48000, hits = [];
  const d = new c.OnsetDetector(sr, e => { if (e.type === 'hit') hits.push(e); });
  d.set({ thr: 0.02, refrac: 0.04, flam });
  const n = sr, buf = new Float32Array(n);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const strike = (t, a) => { const s0 = Math.round(t * sr); for (let i = 0; i < sr * 0.05 && s0 + i < n; i++) buf[s0 + i] += a * Math.exp(-i / (0.004 * sr)) * (Math.sin(i * 0.9) * 0.7 + (rnd() - 0.5) * 0.6); };
  if (graceAmp) strike(0.2, graceAmp);
  strike(0.2 + gap, mainAmp);
  for (let i = 0; i < n; i += 128) d.process(buf.subarray(i, i + 128), i);
  return hits.map(h => +h.t.toFixed(3));
}

test('detector: a soft grace does not hide the loud main stroke when flams are on', () => {
  for (const gap of [0.02, 0.03, 0.06]) {
    const h = detect(0.07, gap, 0.12, 0.6);
    assert.ok(h.some(t => Math.abs(t - (0.2 + gap)) < 0.004), 'main stroke heard at gap ' + gap + ' ms: ' + h);
  }
});

test('detector: a single hit is heard once', () => {
  const h = detect(0.07, 0.03, 0, 0.6);
  assert.equal(h.length, 1);
});

test('mastery is measured in strokes a minute, so sixteenths count for more than eighths', () => {
  const key = x => c.textKey(x, 4);
  const sixteenths = key('RLRL RLRL');       /* four strokes to the beat */
  const eighths = key('8 RLRL RLRL');     /* two strokes to the beat */
  assert.equal(c.strokeRate(sixteenths, 60), 240);
  assert.equal(c.strokeRate(eighths, 60), 120);
  assert.equal(c.masteryTier(sixteenths, 60), 3);   /* Gold */
  assert.equal(c.masteryTier(eighths, 60), 1);      /* Bronze */
  assert.equal(c.masteryTier(eighths, 40), 0);      /* Hickory: cleared, but slow */
  assert.equal(c.masteryTier(sixteenths, 150), 7);  /* Diamond */
  assert.equal(c.MTIER.length, c.RATE_AT.length + 1);
  /* rests are not strokes, and a half-note beat counts its own strokes */
  assert.equal(c.strokeRate(key('R_L_ R_L_'), 60), 120);
  assert.equal(c.strokeRate(key('2/2: RLRL RLRL'), 70), 280);
});

test('scoring: the worked examples, the streak cap, the floor at zero and a streak carried across exercises', () => {
  assert.equal(runPoints('oooboomo', 'strokes'), 24);
  assert.equal(runPoints('oooboomo', 'half'), 78);
  assert.equal(runPoints('oooboomo', 'none'), 150);
  assert.equal(runPoints('ooroo', 'strokes'), runPoints('oooo', 'strokes'), 'a rest scores nothing and keeps the streak');
  assert.equal(runPoints('o'.repeat(20), 'strokes'), 198);   // 3 x (51 for the first 17 strokes + 5 for each of the next 3): the bonus stops growing at x5
  assert.equal(runPoints('mmm', 'none'), 0, 'never below zero');
  assert.equal(runPoints('obm', 'bar'), 17);
  const ex = q => ({ k: 'e', due: q.length, within: 0, q });
  const run = (lv, ...qs) => ({ id: lv + qs.join(''), t: 1, lv, bpm: 60, exercises: qs.map(ex) });
  assert.equal(c.runScore(run('half', 'ooo', 'ooo')), runPoints('oooooo', 'half'), 'the streak carries from one exercise to the next');
  const hs = c.highScores([run('half', 'oooo'), run('half', 'ooooooo'), run('none', 'oo')], c.newSum());
  assert.equal(hs.half, runPoints('ooooooo', 'half'));
  assert.equal(hs.none, runPoints('oo', 'none'));
  const sum = c.newSum(); sum.hs.half = 99999;
  assert.equal(c.highScores([run('half', 'oo')], sum).half, 99999, 'an older folded best still stands');
  assert.equal(c.badgeValues([run('half', 'oooo')], c.newSum()).hhalf, runPoints('oooo', 'half'));
});

test('a run saved without score codes is scored from its stroke data', () => {
  // four strokes: on time, on time, off time, missed (result letters o o b m, no timing or level)
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', SPR = 'obmsl';
  const sp = [...'oobm'].map(r => B64[SPR.indexOf(r)] + B64[63] + B64[63] + B64[63]).join('');
  const run = { id: 'x', t: 1, lv: 'half', bpm: 60, exercises: [{ k: 'e', due: 4, within: 2, sp }] };
  assert.equal(c.runScore(run), runPoints('oobm', 'half'));
});

test('each level has its own high-score ladder, scaled by points per on-time stroke', () => {
  const h = id => c.BADGES.find(b => b.id === id).at;
  assert.deepEqual(h('hnone')[9], 380000);
  assert.deepEqual(h('hstrokes')[9], 56000);
  assert.deepEqual(h('hhalf')[9], 190000);
  ['hstrokes', 'hbeat', 'hhalf', 'hbar', 'hnone'].forEach(id => h(id).forEach((n, i, a) => { if (i) assert.ok(n > a[i - 1], id + ' climbs'); }));
});

test('maxPoints equals a flawless run, across exercises of different speed', () => {
  [1, 2, 8, 17, 18, 40, 500].forEach(n => ['strokes', 'half', 'none'].forEach(lv => assert.equal(c.maxPoints([[n, 1]], lv), runPoints('o'.repeat(n), lv), n + ' ' + lv)));
  assert.equal(c.maxPoints([[10, 2], [10, 0.5]], 'half'), c.scoreParts([['o'.repeat(10), 2], ['o'.repeat(10), 0.5]], 'half'), 'the streak carries across exercises of different speed');
});

test('tempo multiplier: 240 strokes a minute is x1, between x0.5 and x2', () => {
  assert.equal(c.tempoMult('RLRL RLRL RLRL RLRL', 60), 1);        // sixteenths at 60 BPM = 240
  assert.equal(c.tempoMult('RLRL RLRL RLRL RLRL', 120), 2);       // 480, at the cap
  assert.equal(c.tempoMult('RLRL RLRL RLRL RLRL', 200), 2);       // capped
  assert.equal(c.tempoMult('RLRL RLRL RLRL RLRL', 30), 0.5);      // 120, at the floor
  assert.ok(Math.abs(c.tempoMult('RLRL RLRL RLRL RLRL', 40) - 160 / 240) < 1e-9, '160 strokes a minute');
  const run = bpm => ({ id: 'x', t: 1, lv: 'half', bpm, exercises: [{ k: 'RLRL RLRL RLRL RLRL', bpm, due: 4, within: 4, q: 'oooo' }] });
  assert.equal(c.runScore(run(120)), 2 * c.runScore(run(60)));
});

test('score breakdown counts strokes and the longest streak, and best shares compare runs of different length', () => {
  const run = (lv, q, extra) => Object.assign({ id: q, t: 1, lv, bpm: 60, exercises: [{ k: 'RLRL RLRL RLRL RLRL', bpm: 60, due: q.replace(/r/g, '').length, miss: (q.match(/m/g) || []).length, within: 0, q }] }, extra);
  const d = c.scoreBreakdown(run('half', 'ooobormo'));
  assert.deepEqual([d.on, d.off, d.miss, d.best, d.tempo], [5, 1, 1, 3, 1]);
  const short = run('half', 'oo'), long = run('half', 'o'.repeat(40) + 'b'.repeat(40));
  assert.equal(c.runShare(short), 1);
  assert.ok(c.runShare(long) < 1 && c.runShare(long) > 0.3);
  assert.equal(c.bestShares([short, long], c.newSum())['half|20'], 1, 'kept per level and window; a run without a window was at ±20 ms');
  const sum = c.newSum(); sum.hr['half|20'] = 0.9;
  assert.equal(c.bestShares([long], sum)['half|20'], 0.9, 'an older folded best still stands');
  assert.equal(c.bestShares([Object.assign({}, short, { tol: 50 })], c.newSum())['half|20'], undefined, 'a best at ±50 ms is not a best at ±20 ms');
});

test('score breakdown separates unplayed strokes from hits on a rest', () => {
  const run = { id: 1, t: 1, lv: 'half', bpm: 60, exercises: [{ k: 'RLRL', bpm: 60, due: 4, miss: 1, within: 0, q: 'ooomrm' }] };
  const d = c.scoreBreakdown(run);
  assert.deepEqual([d.due, d.on, d.miss, d.rest], [4, 3, 1, 1]);
});

test('an off-time stroke takes the streak back two steps, and a miss resets it', () => {
  assert.equal(c.streakAfter(5, 'o'), 6);
  assert.equal(c.streakAfter(16, 'b'), 14);
  assert.equal(c.streakAfter(16, 'o'), 16, 'the streak stops at the best');
  assert.equal(runPoints('o'.repeat(30) + 'bo', 'half') - runPoints('o'.repeat(30), 'half'), 3 + 10 * 4.5, 'at the best, one off-time stroke really does cost two steps');
  assert.equal(c.streakAfter(1, 'b'), 0, 'never below zero');
  assert.equal(c.streakAfter(9, 'm'), 0);
  // 'half': ten on time, one off time, then on time again: the bonus carries on from step 8
  const t = (q, l) => runPoints(q, l);
  assert.ok(t('ooooooooooboo', 'half') > t('oooooooooomoo', 'half'), 'a late stroke costs less than a missed one');
  assert.equal(t('oob', 'half') + 10, t('oobo', 'half'), 'after an off-time stroke at streak 2 the next stroke starts again');
  assert.equal(t('ooobo', 'half'), 53, 'at streak 3 it keeps one step: 10 + 12.5 + 15 + 3 + 12.5');
});

test('the longest clean run counts strokes, so a short routine counts too', () => {
  const ex = (due, within) => ({ k: 'e' + due + within, due, within, q: 'o'.repeat(within) + 'b'.repeat(due - within) });
  const run = (...xs) => ({ id: 'r' + xs.join(), t: 1, lv: 'half', bpm: 60, sec: 20, ne: xs.length, exercises: xs.map(([d, w]) => ex(d, w)) });
  assert.equal(c.badgeValues([run([32, 32], [32, 30])], c.newSum()).cln, 64, 'a 20-second routine with every exercise at 90% or more counts its 64 strokes');
  assert.equal(c.badgeValues([run([32, 32], [32, 20])], c.newSum()).cln, 0, 'one exercise under 90% and the run is not clean');
  const sum = c.newSum(); sum.cs = 3000;
  assert.equal(c.badgeValues([run([32, 32], [32, 32])], sum).cln, 3000, 'an older folded best still stands');
});

test('the on-time window scales points and the maximum alike, so a flawless run is 100% at any window', () => {
  const run = tol => ({ id: 'w' + tol, t: 1, lv: 'half', bpm: 60, tol, exercises: [{ k: 'e', due: 8, within: 8, q: 'oooooooo' }] });
  const std = c.runScore(run(20));
  assert.equal(c.runMax(run(20)), std, 'a flawless run at the standard window is 100%');
  assert.equal(c.runScore(run(50)), Math.round(std / 1.5), 'the widest window is x1');
  assert.equal(c.runScore(run(10)), Math.round(std / 1.5 * 2), 'the tightest is x2');
  assert.equal(c.runMax(run(50)), c.runScore(run(50)), 'a flawless run at ±50 is 100%');
  assert.equal(c.runMax(run(10)), c.runScore(run(10)), 'a flawless run at ±10 is 100%, not 150%');
  assert.equal(c.winMult(undefined), 1, 'a run saved without a window counts once');
});

/* Readings of both clocks every 1/60 s for `secs`, with the audio clock running at `rate` and ticking every `tick` s. */
function clockRun(secs, rate, tick, stallAt) {
  let st = null;
  for (let w = 0; w <= secs; w += 1 / 60) {
    let a = Math.floor(w * rate / tick) * tick;
    if (stallAt != null && w > stallAt) a = Math.min(a, Math.floor(stallAt * rate / tick) * tick + Math.max(0, w - stallAt - 0.5) * rate);
    st = c.clockStep(st, w, a);
  }
  return c.clockVerdict(st);
}

test('audio clock: a healthy clock passes, even one that only ticks every 85 ms', () => {
  assert.equal(clockRun(10, 1, 0.003).ok, true);
  assert.equal(clockRun(10, 1, 0.085).ok, true);
  assert.equal(c.clockVerdict(null).ok, true);
});

test('audio clock: a slow clock is caught once the sound is 0.2 s behind', () => {
  const v = clockRun(3, 0.92, 0.003);   /* a 48 kHz context on 44.1 kHz hardware */
  assert.equal(v.ok, false);
  assert.ok(v.slip > 0.2 && Math.abs(v.rate - 0.92) < 0.01, JSON.stringify(v));
  assert.equal(clockRun(1, 0.92, 0.003).ok, true, 'not before it has slipped 0.2 s');
});

test('audio clock: a clock that stops for half a second is caught', () => {
  const v = clockRun(4, 1, 0.003, 1);   /* stops for half a second after 1 s */
  assert.equal(v.ok, false);
  assert.ok(v.slip > 0.45, JSON.stringify(v));
});
