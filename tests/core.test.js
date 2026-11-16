const test = require('node:test'), assert = require('node:assert/strict');
const { loadCore, plain } = require('./helpers');
const c = loadCore(['parseStrokes', 'nameMarkers', 'fmtPattern', 'parseExerciseLine', 'parseRoutine', 'resolveExercises', 'buildPlan', 'builderApply',
  'graceSlot', 'leadSlot', 'envOnsets', 'matchStrokes', 'graceMain', 'buzzAt', 'bounceSlot', 'strokeOf', 'buzzSep', 'buzzStats', 'envDb', 'buzzCounts', 'buzzSingles', 'buzzNote', 'OnsetDetector', 'patKey', 'parseSig', 'textKey', 'nearestSlot', 'analyseCheck', 'strokeRate', 'masteryTier', 'MTIER', 'RATE_AT', 'badgeValues', 'foldRun', 'newSum', 'runScore', 'runMax', 'winMult', 'highScores', 'unpackStrokes', 'BADGES', 'maxPoints', 'tempoMult', 'scoreParts', 'runShare', 'bestShares', 'scoreBreakdown', 'streakAfter', 'clockStep', 'clockVerdict']);

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

test('buzz strokes: z goes in front of a stroke', () => {
  assert.deepEqual(plain(c.parseStrokes('zR zL Zr', 4).notes), ['zR', 'zL', 'zR']);
  for (const bad of ['z', 'zR z', 'z_', 'zfR'])
    assert.match(c.parseStrokes(bad, 4).err, /buzz/, bad);
  const k = x => c.textKey(x, 4);
  assert.notEqual(k('RLRL'), k('zRLRL'));
});

test('tuplets: N:M is N notes in the time of M sixteenths', () => {
  const r = c.parseStrokes('8 RLR 8:6 LRLRLRLR', 8);
  assert.equal(r.err, undefined);
  assert.deepEqual(plain(r.subs.slice(0, 4)), [1, 1, 1, 8 / 3]);
  assert.deepEqual(plain(r.groupStart), [true, false, false, true, false, false, false, false, false, false, false]);
  /* 6:4 is the same as 16t, and grouping by N does not need spaces */
  assert.deepEqual(plain(c.parseStrokes('6:4 RLRLRLRLRLRL', 4).subs), Array(12).fill(6));
  assert.deepEqual(plain(c.parseStrokes('5:4 RLRLRLRLRL', 4).groupStart).map(Number), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.match(c.parseStrokes('1:4 RL', 4).err, /at least 2 notes/);
  assert.match(c.parseStrokes('2:16 RL', 4).err, /too fast or too slow/);
  /* up to 16 notes in a beat: ten sixteenths and 32nds in a half note beat of cut time */
  assert.equal(c.parseStrokes('8 RLRL 10:8 RRLLRRLLRR', 2).err, undefined);
  assert.deepEqual(plain(c.parseStrokes('32 RLRLRLRLRLRLRLRL', 2).subs), Array(16).fill(16));
  assert.match(c.parseStrokes('17:8 RL', 2).err, /too fast or too slow/);
  /* a bar of 6/8: three eighths and eight in the time of three eighths fill it */
  const text = `time: 6/8
8 RLR 8:6 LRLRLRLR 8 LRL 8:6 RLRLRLRL
RLR 8:6 LRLRLRL_
Ex 3: 8 RLR 8:6 LRLRLRLR`;
  const p = c.parseRoutine(text);
  assert.deepEqual(plain(p.errors), []);
  assert.equal(p.exercises.length, 3);
  const e = p.exercises[0], key = c.patKey(e.notes, e.groupStart, e.subs, 1, e.sig);
  assert.ok(key.includes('/8:3 LRLRLRLR'), key);
  /* a key without the routine's text names the tuplet by its lowest terms */
  assert.equal(c.nameMarkers(c.fmtPattern(['R', 'L'], [true, false], [8 / 3, 8 / 3], 0), 8), '4:3 RL');
  /* the plan spaces the eight evenly over three eighths: at 60 BPM an eighth is a second */
  const { plan: pl } = plan(text);
  const t = pl.slots.slice(0, 11).map(x => x.t - pl.slots[0].t);
  assert.ok(Math.abs(t[3] - 3) < 1e-9, String(t[3]));
  for (let i = 4; i < 11; i++) assert.ok(Math.abs(t[i] - t[i - 1] - 0.375) < 1e-9, String(t));
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

test('plan: buzz flags, and how far a buzz rings', () => {
  const { plan: pl } = plan('16 zR L zL R');
  const s = pl.slots;
  assert.deepEqual(plain(s.map(x => x.bz)), [true, false, true, false]);
  assert.equal(c.buzzAt(s, s[0].t + 0.1), 0);
  assert.equal(c.buzzAt(s, s[1].t + 0.1), -1);
  assert.equal(c.buzzAt(s, s[1].t - 0.005), -1);   /* just before the next stroke is not part of the buzz */
});

test('buzz stats count the bounces after each stroke and how far it rang', () => {
  const { plan: pl } = plan('16 zR zL zR zL');
  const s = pl.slots, res = new Map(), bnc = [];
  s.forEach((x, i) => {
    res.set(i, { ms: 0 });
    for (let b = 1; b <= (i === 3 ? 1 : 10); b++) bnc.push(x.t + b * 0.02);   /* the last one bounces once */
  });
  const st = c.buzzStats(s, res, bnc);
  assert.deepEqual(plain(st.map(x => x.n)), [10, 10, 10, 1]);
  assert.ok(st[0].fill > 0.8 && st[0].fill <= 1, 'fill ' + st[0].fill);
  assert.equal(c.buzzSingles(s, st).size, 0);   /* one bounce among buzzes is not a single */
  assert.doesNotMatch(c.buzzNote(st, 0), /single/);
  const note = c.buzzNote(st, 1);
  assert.match(note, /bounced 7\.8 times/);
  assert.match(note, /1 of 4 sounded like single strokes/);
  assert.equal(c.buzzNote(st.slice(0, 3)), '');
});

test('graceSlot finds a flam only just before its main stroke', () => {
  const { plan: pl } = plan('8 R fL R L');
  const s = pl.slots, t = s[1].t;
  assert.equal(c.graceSlot(s, t - 0.04, 0), 1);
  assert.equal(c.graceSlot(s, t - 0.005, 0), -1);
  assert.equal(c.graceSlot(s, t - 0.2, 0), -1);
  assert.equal(c.graceSlot(s, t - 0.04, 2), -1);
});

/* A loudness trace like the detector's: one peak a millisecond, each strike decaying over about 15 ms, on a quiet floor. */
const strikes = (t0, len, hits) => {
  const n = Math.round(len / 0.001), v = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const t = t0 + k * 0.001;
    let x = 0.002;
    for (const [ht, db] of hits) if (t >= ht) x += Math.pow(10, db / 20) * Math.exp(-(t - ht) / 0.015);
    v[k] = x;
  }
  return { t: t0, dt: 0.001, v, n };
};
const near = (a, b, ms) => Math.abs(a - b) <= ms / 1000;

test('envOnsets finds each strike in the loudness, with its level', () => {
  const env = strikes(1, 1, [[1.2, -6], [1.25, -20], [1.6, 0]]);
  const on = c.envOnsets(env, 1, 2, -40);
  assert.equal(on.length, 3);
  assert.ok(near(on[0].t, 1.2, 1.5) && near(on[1].t, 1.25, 1.5) && near(on[2].t, 1.6, 1.5));
  assert.ok(Math.abs(on[2].db) < 1 && on[1].db < on[0].db);
  assert.equal(c.envOnsets(env, 1, 2, -3).length, 1);   /* only the loudest is over a -3 dB trigger line */
});

test('graceMain times a flam from its main stroke, not the grace before it', () => {
  const s = plan('8 R fL R L').plan.slots, t = s[1].t;
  const env = strikes(0, s[3].t + 0.5, [[s[0].t, -6], [t - 0.04, -22], [t + 0.005, -6], [s[2].t, -6], [s[3].t, -6]]);
  const m = c.graceMain(s, 1, env, -40);
  assert.ok(near(m.t, t + 0.005, 1.5));
  assert.equal(m.gr.length, 1);
  assert.ok(near(m.gr[0], t - 0.04, 1.5));
});

test('graceMain reads a drag whether its graces come before the click or start on it', () => {
  const s = plan('dR R dL L').plan.slots;
  const env = strikes(0, s[3].t + 0.5, [
    [s[0].t - 0.15, -24], [s[0].t - 0.1, -24], [s[0].t - 0.01, -8], [s[1].t, -8],
    [s[2].t, -24], [s[2].t + 0.05, -24], [s[2].t + 0.1, -6], [s[3].t, -8]]);
  const a = c.graceMain(s, 0, env, -40), b = c.graceMain(s, 2, env, -40);
  assert.ok(near(a.t, s[0].t - 0.01, 1.5));
  assert.equal(a.gr.length, 2);
  assert.ok(near(b.t, s[2].t + 0.1, 1.5));   /* graces on the click, the main stroke 100 ms late */
  assert.equal(b.gr.length, 2);
});

test('graceMain takes a much quieter hit just after the stroke as its rebound, not the main stroke', () => {
  const s = plan('dR R dL L').plan.slots;
  const env = strikes(0, s[3].t + 0.5, [[s[0].t, -8], [s[0].t + 0.06, -24], [s[1].t, -8], [s[2].t, -8], [s[3].t, -8]]);
  const m = c.graceMain(s, 0, env, -40);
  assert.ok(near(m.t, s[0].t, 1.5));
  assert.equal(m.gr.length, 0);
  assert.equal(m.tl.length, 1);
  assert.equal(c.graceMain(s, 0, strikes(0, 2, []), -40), null);   /* nothing heard */
});

test('matchStrokes charges no extras in the lead-in, and misses a stroke not played', () => {
  const s = plan('R L R L').plan.slots;
  const on = [{ t: s[0].t - 1, db: -6 }, { t: s[0].t, db: -6 }, { t: s[2].t + 0.01, db: -6 }, { t: s[3].t, db: -6 }];
  const r = c.matchStrokes(s, on);
  assert.equal(r[0].main, 1);
  assert.equal(r[1], null);
  assert.equal(r[2].main, 2);
  assert.equal(r[3].main, 3);
});

test('graceMain reads only what was heard by the end of its own window, and a hit in its run-up is held for it', () => {
  const s = plan('q dR R dL L').plan.slots, t = s[0].t;
  const hits = [[t - 0.1, -24], [t - 0.05, -24], [t, -8]];
  const env = strikes(0, s[3].t + 0.5, hits.concat([[s[0].t + s[0].w + 0.02, 0], [s[1].t, -8]]));
  const m = c.graceMain(s, 0, env, -40);
  assert.ok(near(m.t, t, 1.5));
  assert.equal(m.gr.length, 2);
  assert.ok(!m.tl.some(x => x > s[0].t + s[0].w));   /* a strike after its window is not read */
  assert.equal(c.leadSlot(s, s[2].t - s[2].w - 0.1, 1), 2);
  assert.equal(c.leadSlot(s, s[2].t - s[2].w - 0.3, 1), -1);
  assert.equal(c.leadSlot(s, s[2].t - s[2].w - 0.1, 3), -1);
});

test('builder taps edit the text', () => {
  assert.equal(c.builderApply('R ', 'fL'), 'R fL');
  assert.equal(c.builderApply('RfL', 'back'), 'R');
  assert.equal(c.builderApply('RLfR', 'swap'), 'LRfL');
  assert.equal(c.builderApply('RL', 'code:8'), 'RL 8 ');
  assert.equal(c.builderApply('R ', 'zL'), 'R zL');
  assert.equal(c.builderApply('RzL', 'back'), 'R');
  assert.equal(c.builderApply('zRL', 'swap'), 'zLR');
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

test('loudness strip: the peak level of the run between two times, in dB', () => {
  const v = new Float32Array(100).fill(0.001); v[40] = 0.1; v[41] = 1;
  const env = { t: 2, dt: 0.001, v, n: 50 };
  assert.ok(Math.abs(c.envDb(env, 2.030, 2.045) - 0) < 0.01);
  assert.ok(Math.abs(c.envDb(env, 2.040, 2.041) + 20) < 0.01);
  assert.ok(Math.abs(c.envDb(env, 2.0402, 2.0404) + 20) < 0.01);   /* inside one millisecond: that millisecond */
  assert.ok(Math.abs(c.envDb(env, 2.000, 2.010) + 60) < 0.01);
  assert.equal(c.envDb(env, 2.060, 2.070), null);   /* not heard yet */
  assert.equal(c.envDb(env, 1.0, 1.5), null);
});

test('detector: with trace on, it sends the peak of each millisecond', () => {
  const sr = 48000, env = [];
  const d = new c.OnsetDetector(sr, e => { if (e.type === 'env') env.push(e); });
  const buf = new Float32Array(sr * 0.2);
  buf[Math.round(0.1 * sr)] = 0.5;
  for (let i = 0; i < buf.length; i += 128) d.process(buf.subarray(i, i + 128), i);
  assert.equal(env.length, 0);   /* off by default */
  d.set({ trace: true });
  for (let i = 0; i < buf.length; i += 128) d.process(buf.subarray(i, i + 128), buf.length + i);
  assert.equal(env.length, 3);
  assert.ok(Math.abs(env[0].t - 0.2) < 1e-9 && env[0].dt === 0.001);
  const all = env.flatMap(e => Array.from(e.v)), k = all.findIndex(v => v > 0.3);
  assert.equal(k, 100);
});

/* A buzz: a strike and a run of fading bounces every 20 ms, for each stroke of a roll. */
function detectBuzz(buzz, times, bounces, amps) {
  const sr = 48000, hits = [], bnc = [];
  const d = new c.OnsetDetector(sr, e => { if (e.type === 'hit') hits.push(e.t); else if (e.type === 'bnc') bnc.push(e.t); });
  d.set({ thr: 0.02, refrac: 0.04, flam: 0, buzz });
  const n = sr, buf = new Float32Array(n);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const strike = (t, a) => { const s0 = Math.round(t * sr); for (let i = 0; i < sr * 0.03 && s0 + i < n; i++) buf[s0 + i] += a * Math.exp(-i / (0.003 * sr)) * (Math.sin(i * 0.9) * 0.7 + (rnd() - 0.5) * 0.6); };
  times.forEach((t, k) => {
    const a0 = amps ? amps[k] : 0.6, nb = amps && amps[k] === 0.6 ? 0 : bounces;   /* with amps, a full strike is a plain stroke */
    strike(t, a0); for (let b = 1, a = a0 * 0.67; b <= nb; b++, a *= 0.8) strike(t + b * 0.02, a);
  });
  for (let i = 0; i < n; i += 128) d.process(buf.subarray(i, i + 128), i);
  return { hits, bnc };
}

test('detector: with buzz on, a buzz is one hit and its bounces', () => {
  const times = [0.2, 0.45, 0.7];
  const { hits, bnc } = detectBuzz(0.15, times, 9);
  assert.equal(hits.length, 3, 'hits ' + hits);
  times.forEach((t, i) => assert.ok(Math.abs(hits[i] - t) < 0.004, 'stroke ' + t + ' heard at ' + hits[i]));
  assert.ok(bnc.length >= 18, 'bounces ' + bnc.length);
});

test('detector: a closed roll, each buzz ringing into the next, still finds every stroke', () => {
  const times = [0.2, 0.325, 0.45, 0.575, 0.7];
  for (const bounces of [4, 5, 6]) {
    const { hits, bnc } = detectBuzz(0.075, times, bounces);
    assert.equal(hits.length, times.length, bounces + ' bounces, hits ' + hits);
    times.forEach((t, i) => assert.ok(Math.abs(hits[i] - t) < 0.004, 'stroke ' + t + ' heard at ' + hits[i]));
    assert.ok(bnc.length >= times.length * (bounces - 1), 'bounces ' + bnc.length);
  }
});

test('detector: a soft buzz just after a loud stroke comes as a bounce, and can stand in for its stroke', () => {
  /* As heard on an iPhone: a single stroke, then a buzz under half as loud, played 10 ms early while the single still rings
     (the detector listens for bounces for the shortest gap between strokes, here 100 ms). */
  const due = [0.2, 0.3, 0.4, 0.5], times = [0.2, 0.3, 0.39, 0.5], amps = [0.6, 0.6, 0.25, 0.25];
  const { hits, bnc } = detectBuzz(0.06, times, 4, amps);
  assert.ok(!hits.some(t => Math.abs(t - 0.39) < 0.004), 'the soft buzz reaches the app as a bounce, hits ' + hits);
  const soft = bnc.find(t => Math.abs(t - 0.39) < 0.004);
  assert.ok(soft !== undefined, 'a bounce at the soft buzz, bounces ' + bnc);
  const sl = due.map(t => ({ t, w: 0.05 }));
  assert.equal(c.bounceSlot(sl, soft, 2, 0.25, 0.6), 2);
});

test('a bounce stands in for a stroke only in its window, while it waits, and when loud enough', () => {
  const sl = [{ t: 1, w: 0.05 }, { t: 1.25, w: 0.05 }];
  assert.equal(c.bounceSlot(sl, 1.26, 0, 0.2, 0.6), 1);
  assert.equal(c.bounceSlot(sl, 1.12, 0, 0.2, 0.6), -1);   /* between the strokes: a bounce */
  assert.equal(c.bounceSlot(sl, 1.26, 2, 0.2, 0.6), -1);   /* already judged */
  assert.equal(c.bounceSlot(sl, 1.26, 0, 0.1, 0.6), -1);   /* under -12 dB of the last stroke */
  assert.equal(c.bounceSlot([], 1, 0, 1, 0), -1);
  /* a real hit beats a stand-in; among stand-ins, the loudest is the attack */
  assert.equal(c.strokeOf([{ e: 0.001, pk: 0.3, bn: true }, { e: 0.02, pk: 0.2 }]).e, 0.02);
  assert.equal(c.strokeOf([{ e: -0.01, pk: 0.3, bn: true }, { e: 0.005, pk: 0.2, bn: true }]).e, -0.01);
});

test('detector: buzz strokes with a loud rebound half a gap after each are still scored on the line', () => {
  /* A single, then buzz strokes 300 ms apart, each with one rebound 140 ms after it, a little louder. The first buzz is under half as
     loud as the single still ringing, so it comes as a bounce, and so may its rebound; once a rebound comes as a hit, the next strike
     is too soon after it for a stroke and is a bounce too. Taken at face value, buzzes score 140 ms late. */
  const sr = 48000, n = Math.round(sr * 2.2), buf = new Float32Array(n), ev = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const strike = (t, a) => {
    const s0 = Math.round(t * sr);
    for (let i = 0; i < sr * 0.3 && s0 + i < n; i++) {
      const w = Math.sin(i * 0.9) * 0.7 + (rnd() - 0.5) * 0.6;
      buf[s0 + i] += a * (Math.exp(-i / (0.003 * sr)) + 0.15 * Math.exp(-i / (0.3 * sr))) * w;   /* the attack, then the pad ringing */
    }
  };
  const due = [0.2, 0.5, 0.8, 1.1, 1.4, 1.7];
  strike(0.2, 0.6);
  for (let k = 1; k <= 4; k++) { strike(due[k], 0.25); strike(due[k] + 0.14, 0.3); }
  strike(1.7, 0.6);
  const d = new c.OnsetDetector(sr, e => { if (e.type === 'hit' || e.type === 'bnc') ev.push(e); });
  d.set({ thr: 0.02, refrac: 0.04, flam: 0, buzz: 0.18 });
  for (let i = 0; i < n; i += 128) d.process(buf.subarray(i, i + 128), i);
  const sl = due.map((t, k) => ({ t, w: 0.15, seg: 0, bz: k >= 1 && k <= 4 }));
  const on = ev.filter(e => due.some(t => Math.abs(e.t - t) < 0.004));
  assert.ok(on.some(e => e.type === 'bnc'), 'a strike on the line came as a bounce: ' + JSON.stringify(ev));
  const per = sl.map(() => []);
  for (const e of ev) {
    const i = c.nearestSlot(sl, e.t);
    if (Math.abs(e.t - sl[i].t) <= sl[i].w) per[i].push({ e: e.t - sl[i].t, pk: e.pk, bn: e.type === 'bnc' });
  }
  const old = per.map(h => h.length ? c.strokeOf(h).e : null), now = per.map((h, i) => h.length ? c.strokeOf(h, c.buzzSep(sl, i)).e : null);
  assert.ok(old.some(e => e > 0.1), 'without the buzz rule a rebound wins: ' + old);
  now.forEach((e, i) => assert.ok(e !== null && Math.abs(e) < 0.004, 'stroke ' + i + ' scored at ' + e + ' ' + JSON.stringify(per[i])));
});

test('near a buzz stroke, a stand-in nearer the click, at least half as loud and well apart beats the choice', () => {
  const sl = [{ t: 0, seg: 0 }, { t: 0.3, seg: 0, bz: true }, { t: 0.6, seg: 0 }, { t: 0.9, seg: 1 }];
  assert.deepEqual(sl.map((x, i) => Math.round(c.buzzSep(sl, i) * 1000)), [0, 100, 100, 0]);
  const h = [{ e: 0.001, pk: 0.3, bn: true }, { e: 0.14, pk: 0.4 }];
  assert.equal(c.strokeOf(h, 0.1).e, 0.001);
  assert.equal(c.strokeOf(h, 0).e, 0.14);
  assert.equal(c.strokeOf([{ e: 0.001, pk: 0.3, bn: true }, { e: 0.14, pk: 0.4, bn: true }], 0.1).e, 0.001);   /* the rebound came as a bounce too */
  assert.equal(c.strokeOf([{ e: -0.14, pk: 0.4 }, { e: 0.005, pk: 0.3, bn: true }], 0.1).e, 0.005);   /* the rebound of the stroke before */
  assert.equal(c.strokeOf([{ e: 0.001, pk: 0.15, bn: true }, { e: 0.14, pk: 0.4 }], 0.1).e, 0.14);   /* a quiet bounce near the click */
  assert.equal(c.strokeOf([{ e: -0.06, pk: 0.4, bn: true }, { e: 0.02, pk: 0.4 }], 0.1).e, 0.02);   /* a hit nearer the click */
  /* a buzz played 40 ms early: its own bounces after it, nearer the click, are not its stroke */
  assert.equal(c.strokeOf([{ e: -0.04, pk: 0.4, bn: true }, { e: -0.02, pk: 0.27, bn: true }, { e: 0.0, pk: 0.21, bn: true }], 0.1).e, -0.04);
});

test('buzz stats can take one exercise', () => {
  const s = [{ t: 0, seg: 0, bz: true }, { t: 0.2, seg: 0, bz: false }, { t: 1, seg: 1, bz: true }, { t: 1.2, seg: 1, bz: false }];
  const res = new Map(s.map((x, i) => [i, { ms: 0 }])), bnc = [0.02, 0.04, 1.02];
  assert.deepEqual(plain(c.buzzStats(s, res, bnc, 1).map(x => x.n)), [1]);
  assert.equal(c.buzzStats(s, res, bnc).length, 2);
});

test('buzz singles: a group of buzz strokes with few bounces, or a few and as loud as the plain strokes', () => {
  /* RLRL zRzLzRzL zRzLzRzL: groups of four from the start of a run of buzz strokes, misses left out of the average */
  const s = [], st = [], res = new Map();
  for (let k = 0; k < 20; k++) s.push({ t: k * 0.4, seg: 0, bz: k >= 4 });
  [0, 1, 2, 3].forEach(i => res.set(i, { ms: 0, db: -20 }));   /* the plain strokes, at -20 dB */
  const g = (i, n, db) => { st.push({ i: i, n: n, db: db }); res.set(i, { ms: 0, db: db }); };
  [1, 0, 1, 2].forEach((n, j) => g(4 + j, n, -26));     /* averages 1: singles, however quiet */
  [2, 1, 2, 1].forEach((n, j) => g(8 + j, n, -21));     /* averages 1.5 and 1 dB quieter: singles */
  [2, 1, 2, 1].forEach((n, j) => g(12 + j, n, -23));    /* 1.5 but 3 dB quieter: buzzes */
  [3, 2, 1].forEach((n, j) => g(16 + j, n, -20));       /* 2, as loud: buzzes; slot 19 missed */
  const ones = c.buzzSingles(s, st, res);
  assert.deepEqual([...ones].sort((a, b) => a - b), [4, 5, 6, 7, 8, 9, 10, 11]);
  /* with no plain strokes to compare, only the bounces count */
  assert.deepEqual([...c.buzzSingles(s, st)].sort((a, b) => a - b), [4, 5, 6, 7]);
  /* a stroke with no bounce among buzzes is not a single on its own */
  assert.equal(c.buzzSingles(s, [{ i: 4, n: 0 }, { i: 5, n: 4 }, { i: 6, n: 3 }, { i: 7, n: 3 }]).size, 0);
  /* a buzz in another exercise does not join the run */
  const s3 = [{ t: 0, seg: 0, bz: true }, { t: 0.4, seg: 1, bz: true }];
  assert.equal(c.buzzSingles(s3, [{ i: 0, n: 0 }, { i: 1, n: 0 }]).size, 0);
});

test('buzz counts give the bounces of each buzz stroke, - for a miss', () => {
  const s = [0, 1, 2, 3, 4].map(k => ({ t: k * 0.5, seg: k < 4 ? 0 : 1, bz: k !== 1 }));
  const res = new Map([[0, { ms: 0 }], [1, { ms: 0 }], [2, { miss: true }], [3, { ms: 0 }], [4, { ms: 0 }]]);
  const bnc = [0.02, 0.04, 1.52];
  for (let b = 1; b <= 12; b++) bnc.push(2 + b * 0.02);   /* twelve bounces are written as 9 */
  assert.equal(c.buzzCounts(s, res, bnc), '2-19');
  assert.equal(c.buzzCounts(s, res, bnc, 0), '2-1');
  assert.equal(c.buzzCounts(s, res, bnc, 1), '9');
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

test('achievements: pace, practice time, routines, gold medals, tight window, even strokes, and perfect without extras', () => {
  const K = 'RLRL RLRL RLRL RLRL';   /* sixteenths: 240 strokes a minute at 60 BPM */
  const ex = (o = {}) => Object.assign({ k: K, due: 32, within: 32, heard: 32, ls: 2.5 }, o);
  const run = (o = {}, xs = [ex()]) => Object.assign({ id: 'r' + Math.random(), t: Date.UTC(2026, 0, 5, 12), lv: 'half', bpm: 60, tol: 20, sec: 600, ne: xs.length, exercises: xs }, o);
  const v = (runs, sum) => c.badgeValues(runs, sum || c.newSum());
  assert.equal(v([run()]).tmp, 240, 'Fastest clear is in strokes a minute');
  assert.equal(v([run({ bpm: 60 }, [ex({ k: '/1 RLRL', bpm: 160 })])]).tmp, 160, 'quarter notes at 160 BPM are 160 strokes a minute, under sixteenths at 60');
  assert.equal(v([run({ sec: 3000 }), run({ sec: 700 })]).min, 1, 'whole hours of practice');
  { const sum = c.newSum(); sum.days['2025-01-01'] = 7200; assert.equal(v([], sum).min, 2, 'folded days count'); }
  const rt = (rk, lv, ok) => run({ rk, lv, ne: 2 }, [ex({ k: 'a' + rk }), ex({ k: 'b' + rk, within: ok ? 32 : 10 })]);
  assert.equal(v([rt('p1', 'half', true), rt('p1', 'half', true), rt('p1', 'beat', true), rt('p2', 'half', false)]).rtn, 2, 'a routine counts once per level, and only when cleared');
  assert.equal(v([run({ bpm: 60 }), run({ bpm: 50 }, [ex({ k: 'LRLR LRLR LRLR LRLR', bpm: 50 })])]).med, 1, 'Gold is 240 strokes a minute or more');
  assert.equal(v([run({ tol: 15 }), run({ tol: 20 }, [ex({ k: 'LRLR LRLR LRLR LRLR' })])]).tgt, 1, 'only ±15 ms or tighter');
  assert.equal(v([run({}, [ex({ ls: 1.8 }), ex({ k: 'LRLR LRLR LRLR LRLR', ls: 2.6 }), ex({ k: 'RRLL RRLL RRLL RRLL', ls: 1.5, within: 20 })])]).evn, 1, 'even and cleared');
  assert.equal(v([run({}, [ex({ ls: null })])]).evn, 0, 'no levels, as on the keyboard, is not even');
  assert.equal(v([run({}, [ex(), ex({ k: 'LRLR LRLR LRLR LRLR', ex: 2 })])]).prf, 1, 'an extra hit spoils a perfect exercise');
  /* the tight and even clears survive folding */
  const sum = c.newSum(), r1 = run({ tol: 10 }, [ex({ ls: 1.5 })]);
  c.foldRun(sum, r1);
  { const o = v([], sum); assert.equal(o.tgt, 1, 'a tight clear survives folding'); assert.equal(o.evn, 1, 'an even clear survives folding'); }
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

/* ---------- findings ---------- */
/* a seeded random number generator and normal scatter, so the synthetic runs are the same every time */
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = r => () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
/* a run's per-exercise results: off(sg, slot, pass) gives each stroke's offset in ms, or null for a miss */
const fakeRun = (pl, off) => pl.segs.map(sg => {
  const sm = [];
  for (let k = 0; k < sg.passes * sg.strokes; k++) { const sl = pl.slots[sg.first + k]; sm.push(off(sg, sl, Math.floor(sl.k / sg.N))); }
  return { sm };
});
const fplan = (text, passes) => {
  const p = c.parseRoutine(text);
  const ex = c.resolveExercises(p.exercises, { unit: 'pass', v: passes || 8 }, { bpm: 60, subdiv: 4 });
  return c.buildPlan(ex, { gapBeats: 0, clickMode: 'strokes', dyn: null });
};

test('findings: a late stroke at a change of sticking is found and named', () => {
  const pl = fplan('RLRR RRLR'), g = gauss(rng(1));
  const f = c.findings(pl, fakeRun(pl, (sg, sl) => g() * 6 + (sl.pos === 5 ? 18 : 0)), 20);
  assert.ok(f.length);
  assert.equal(f[0].what, 'ms');
  assert.deepEqual(plain(f[0].pos), [5]);
  assert.ok(f[0].d >= 12 && f[0].d <= 24, String(f[0].d));
  assert.match(c.findingText(f[0], pl), /^Stroke 6 \(R\), at the change from RLRR to RRLR, lands \d+ ms later than the rest of the exercise\.$/);
});

test('findings: an early stroke reads as earlier', () => {
  const pl = fplan('RLRR RRLR'), g = gauss(rng(2));
  const f = c.findings(pl, fakeRun(pl, (sg, sl) => g() * 6 - (sl.pos === 5 ? 18 : 0)), 20);
  assert.match(c.findingText(f[0], pl), /lands \d+ ms earlier/);
});

test('findings: random scatter rarely gives a finding', () => {
  let hits = 0;
  for (let s = 0; s < 200; s++) {
    const pl = fplan('RLRR RRLR'), g = gauss(rng(100 + s));
    if (c.findings(pl, fakeRun(pl, () => g() * 8), 20).length) hits++;
  }
  assert.ok(hits <= 10, hits + ' of 200 runs of scatter gave a finding');
});

test('findings: a stroke that is often not heard', () => {
  const pl = fplan('RLRL RLRL'), g = gauss(rng(3)), r = rng(4);
  const f = c.findings(pl, fakeRun(pl, (sg, sl) => sl.pos === 3 && r() < 0.6 ? null : g() * 6), 20).filter(x => x.what === 'miss');
  assert.ok(f.length);
  assert.ok(f[0].pos.includes(3));
  assert.match(c.findingText(f[0], pl), /not heard \d+ of \d+ times/);
});

test('findings: a first pass off time and later passes on time', () => {
  const pl = fplan('RLRL RLRL'), g = gauss(rng(5));
  const f = c.findings(pl, fakeRun(pl, (sg, sl, p) => p === 0 ? 40 * (sl.pos % 2 ? 1 : -1) + g() * 4 : g() * 4), 20);
  const s = f.find(x => x.what === 'settle');
  assert.ok(s);
  assert.match(c.findingText(s, pl), /^The first pass was 100% off time and later passes \d+%\. It takes a pass to settle\.$/);
});

test('findings: every exercise of a routine is read, each against itself', () => {
  const pl = fplan('RLRL RLRL\nRLRR RRLR'), g = gauss(rng(6));
  /* the first exercise is 15 ms late throughout, which says nothing; in the second, stroke 6 is late */
  const f = c.findings(pl, fakeRun(pl, (sg, sl) => g() * 6 + (sg.idx === 1 ? 15 : sl.pos === 5 ? 18 : 0)), 20);
  assert.ok(f.length);
  assert.ok(f.every(x => x.ex === 2));
  assert.match(c.findingText(f[0], pl), /^In exercise 2, stroke 6 \(R\)/);
});

test('findings: the second note of each double', () => {
  const pl = fplan('RRLL RRLL'), g = gauss(rng(7));
  const f = c.findings(pl, fakeRun(pl, (sg, sl) => g() * 6 + (sl.pos % 2 ? 15 : 0)), 20);
  assert.equal(f[0].role, 'double2');
  assert.match(c.findingText(f[0], pl), /^The second note of each double lands \d+ ms later/);
});

/* ---------- drills from findings ---------- */
const drillRun = (text, off) => { const pl = fplan(text), g = gauss(rng(1)); const sr = fakeRun(pl, (sg, sl) => g() * 6 + off(sl)); return { pl, sr, f: c.findings(pl, sr, 20) }; };
const parsesAsOne = d => { const p = c.parseRoutine(d.text); assert.deepEqual(plain(p.errors), [], d.text); assert.equal(p.exercises.length, 1, d.text); };

test('drills: a late change of sticking gives the whole beats around it, 10 BPM slower', () => {
  const { pl, sr, f } = drillRun('RLRL RLRL RLRR RRLR', sl => sl.pos === 13 ? 20 : 0);
  const d = c.drillOf(pl, sr, f[0]);
  assert.equal(d.text, '16 RLRR RRLR');
  assert.equal(d.bpm, 50);
  assert.equal(d.beats, 2);
  parsesAsOne(d);
});
test('drills: the window can wrap into the previous pass', () => {
  const { pl, sr, f } = drillRun('RLRR RLRL RLRL RLRL', sl => sl.pos === 0 ? 20 : 0);
  const d = c.drillOf(pl, sr, f[0]);
  assert.equal(d.text, '16 RLRL RLRR');   /* the last beat of one pass, then the first of the next */
  parsesAsOne(d);
});
test('drills: a stroke role gives a drill, and a place in the beat does not', () => {
  const { pl, sr, f } = drillRun('RRLL RRLL', sl => sl.pos % 2 ? 15 : 0);
  const role = f.find(x => x.role === 'double2'), beat = f.find(x => x.kind === 'beat');
  assert.equal(c.drillOf(pl, sr, role).text, '16 RRLL RRLL');
  assert.equal(c.drillOf(pl, sr, beat), null);
});
test('drills: triplets keep their grouping and the tempo never goes below 40 BPM', () => {
  const { pl, sr, f } = drillRun('8t RLR LRL RLR LRR', sl => sl.pos === 10 ? 20 : 0);
  const d = c.drillOf(pl, sr, f[0]);
  assert.equal(d.text, '8t RLR LRR RLR');
  parsesAsOne(d);
  pl.segs[0].bpm = 45;
  assert.equal(c.drillOf(pl, sr, f[0]).bpm, 40);
});

/* ---------- findings: tempo over time and dynamics ---------- */
/* a run with levels: off gives each offset in ms (null for a miss), lv each level in dB (null for none, as on a keyboard) */
const fakeLvRun = (pl, off, lv) => pl.segs.map(sg => {
  const sm = [], sb = [];
  for (let k = 0; k < sg.passes * sg.strokes; k++) {
    const sl = pl.slots[sg.first + k], p = Math.floor(sl.k / sg.N), v = off(sg, sl, p);
    sm.push(v === null ? null : Math.round(v));
    const d = v === null ? null : lv(sg, sl, p);
    sb.push(d === null ? null : Math.round(d));
  }
  return { sm, sb };
});
const aplan = (text, passes) => {
  const p = c.parseRoutine(text);
  const ex = c.resolveExercises(p.exercises, { unit: 'pass', v: passes || 16 }, { bpm: 60, subdiv: 4 });
  return c.buildPlan(ex, { gapBeats: 0, clickMode: 'strokes', dyn: { acc: 'g', oth: 'n' } });
};

test('findings: rushing across a run is found as a drift from late to early', () => {
  const pl = fplan('RLRL RLRL', 16), g = gauss(rng(11)), T = pl.slots[pl.slots.length - 1].t;
  const f = c.findings(pl, fakeRun(pl, (sg, sl) => g() * 6 + 4 - 16 * sl.t / T), 20).filter(x => x.what === 'drift');
  assert.equal(f.length, 1);
  assert.ok(f[0].d <= -10 && f[0].d >= -22, String(f[0].d));
  assert.ok(f[0].from > 0 && f[0].to < 0, f[0].from + ' to ' + f[0].to);
  assert.match(c.findingText(f[0], pl), /^You drifted from \d+ ms late to \d+ ms early over \d+ s: you were rushing\.$/);
  assert.equal(c.drillOf(pl, fakeRun(pl, () => 0), f[0]), null);
});

test('findings: dragging reads as dragging', () => {
  const pl = fplan('RLRL RLRL', 16), g = gauss(rng(12)), T = pl.slots[pl.slots.length - 1].t;
  const f = c.findings(pl, fakeRun(pl, (sg, sl) => g() * 6 + 16 * sl.t / T), 20).filter(x => x.what === 'drift');
  assert.match(c.findingText(f[0], pl), /you were dragging\.$/);
});

test('findings: scatter and level noise rarely give a drift or a level finding', () => {
  let hits = 0;
  for (let s = 0; s < 200; s++) {
    const pl = aplan('RLRR LRLL', 8), g = gauss(rng(300 + s));
    const f = c.findings(pl, fakeLvRun(pl, () => g() * 8, (sg, sl) => -20 + (sl.dy === 'A' ? 8 : 0) + g() * 2.5), 20);
    if (f.some(x => x.what === 'drift' || x.what === 'db' || x.what === 'dbdrift')) hits++;
  }
  assert.ok(hits <= 10, hits + ' of 200 runs of scatter gave a finding');
});

test('findings: a loud tap after each accent asks for a downstroke', () => {
  const pl = aplan('RLRR LRLL'), g = gauss(rng(13));
  const sr = fakeLvRun(pl, () => g() * 5, (sg, sl) => {
    const prev = pl.slots[pl.slots.indexOf(sl) - 1];
    return -20 + (sl.dy === 'A' ? 8 : 0) + (sl.dy !== 'A' && prev && prev.dy === 'A' ? 5 : 0) + g() * 1.5;
  });
  const f = c.findings(pl, sr, 20).filter(x => x.what === 'db');
  assert.equal(f.length, 1, JSON.stringify(f.map(x => [x.kind, x.role, x.d])));
  assert.equal(f[0].role, 'afterAcc');
  assert.equal(c.findingText(f[0], pl), 'The stroke after each accent is ' + f[0].d + ' dB louder than the other taps. Stop the stick low after each accent.');
  assert.ok(f[0].d >= 3 && f[0].d <= 7, String(f[0].d));
  assert.ok(f[0].slots.length >= 24);
});

test('findings: a loud tap before each accent is an upstroke lifted early', () => {
  const pl = aplan('RLRR LRLL'), g = gauss(rng(14));
  const sr = fakeLvRun(pl, () => g() * 5, (sg, sl) => {
    const next = pl.slots[pl.slots.indexOf(sl) + 1];
    return -20 + (sl.dy === 'A' ? 8 : 0) + (sl.dy !== 'A' && next && next.dy === 'A' ? 5 : 0) + g() * 1.5;
  });
  const f = c.findings(pl, sr, 20).filter(x => x.what === 'db');
  assert.equal(f[0].role, 'beforeAcc');
  assert.match(c.findingText(f[0], pl), /^The stroke before each accent is \d+ dB louder than the other taps\. Keep it low, and lift the stick only for the accent\.$/);
});

test('findings: one soft accent is found against the other accents', () => {
  const pl = aplan('RLRR LRLL'), g = gauss(rng(15));
  const f = c.findings(pl, fakeLvRun(pl, () => g() * 5, (sg, sl) => -20 + (sl.dy === 'A' ? (sl.pos === 4 ? 3 : 8) : 0) + g() * 1.5), 20).filter(x => x.what === 'db');
  assert.equal(f.length, 1);
  assert.deepEqual(plain(f[0].pos), [4]);
  assert.match(c.findingText(f[0], pl), /^Stroke 5 \(L\), at the change from RLRR to LRLL, is \d+ dB softer than the other accents\.$/);
});

test('findings: accents pulled early are named as the accents', () => {
  const pl = aplan('RLRR LRLL'), g = gauss(rng(16));
  const f = c.findings(pl, fakeLvRun(pl, (sg, sl) => g() * 5 - (sl.dy === 'A' ? 12 : 0), (sg, sl) => -20 + (sl.dy === 'A' ? 8 : 0) + g() * 1.5), 20).filter(x => x.what === 'ms');
  assert.equal(f[0].role, 'acc');
  assert.match(c.findingText(f[0], pl), /^The accents land \d+ ms earlier than the rest of the exercise\.$/);
});

test('findings: getting softer across a run', () => {
  const pl = aplan('RLRL RLRL'), g = gauss(rng(17)), T = pl.slots[pl.slots.length - 1].t;
  const f = c.findings(pl, fakeLvRun(pl, () => g() * 5, (sg, sl) => -20 + (sl.dy === 'A' ? 8 : 0) - 6 * sl.t / T + g() * 1.5), 20).filter(x => x.what === 'dbdrift');
  assert.equal(f.length, 1);
  assert.match(c.findingText(f[0], pl), /^You got \d dB softer over \d+ s\. Keep the same stick heights to the end\.$/);
});

test('findings: a keyboard run has no levels, so no dynamics findings', () => {
  const pl = aplan('RLRR LRLL'), g = gauss(rng(13));
  const f = c.findings(pl, fakeLvRun(pl, () => g() * 5, () => null), 20);
  assert.ok(!f.some(x => x.what === 'db' || x.what === 'dbdrift'));
});

test('flams and drags: the grace lead and level are summarised, with a word when flat, open or loud', () => {
  const slots = [], res = new Map(), g = gauss(rng(18));
  for (let i = 0; i < 24; i++) {
    slots.push({ gr: i % 3 === 2 ? 2 : (i % 3 ? 1 : 0) });
    if (slots[i].gr === 1) res.set(i, { ms: 0, gl: Math.round(9 + g()), gd: -1 });
    else if (slots[i].gr === 2) res.set(i, { ms: 0, gl: Math.round(80 + g() * 5), gd: -8 });
    else res.set(i, { ms: 0 });
  }
  const st = c.graceStats(slots, res);
  assert.equal(st[1].n, 8);
  assert.ok(st[1].lead >= 8 && st[1].lead <= 10);
  assert.equal(st[2].gd, -8);
  const t = c.graceNotes(st);
  assert.equal(t.length, 2);
  assert.match(t[1], /^Your drags start \d+ ms before the main stroke on average \(spread \d+ ms\), 8 dB under the main stroke\.$/);
  assert.match(t[0], /^Your flams have the grace note \d+ ms ahead on average \(spread \d+ ms\), 1 dB under the main stroke\. That is close to flat: start the grace note a little earlier\. Play the grace note from lower, so it is softer than the main stroke\.$/);
  assert.equal(c.graceStats(slots.slice(0, 12), res)[1], undefined);   /* 4 flams are too few */
  assert.deepEqual(plain(c.graceStats(slots, new Map())), {});
});

test('wander: strokes that drift off the click and back together are found, across exercises', () => {
  const run = (off, rate = 4, secs = 120) => {
    const slots = [], res = new Map();
    for (let i = 0; i < secs * rate; i++) { const t = i / rate; slots.push({ t }); res.set(i, { ms: Math.round(off(t, i)) }); }
    return c.wander(slots, res, 20);
  };
  const g = gauss(rng(21));
  const w = run(t => 40 * Math.sin(t / 3) + g() * 5);   /* a slow swing of 40 ms, with even strokes */
  assert.ok(w, 'found');
  assert.ok(w.early <= -30 && w.late >= 30, JSON.stringify(w));
  assert.ok(w.slots.length > 0);
  assert.match(c.wanderText(w), /^Your timing wanders off the click and back: a few beats at a time you drift up to \d+ ms early and up to \d+ ms late\. Your strokes stay even with each other, so it is the pulse that moves: listen for the click under your strokes\.$/);
  assert.equal(run(() => -25 + g() * 5), null, 'a steady offset does not wander');
  assert.equal(run(t => 40 * Math.sin(t / 3), 4, 10), null, 'too short');
  let hits = 0;
  for (let k = 0; k < 200; k++) if (run(() => g() * 25, 2)) hits++;   /* loose strokes, two a second */
  assert.ok(hits <= 4, hits + ' of 200 noise runs wander');
  const res = new Map([[0, { miss: true }]]);
  assert.equal(c.wander([{ t: 0 }], res, 20), null);
});
