/* The data model for sync: ids and versions are stamps (time, counter, device), totals are kept by device, and merging two copies of
   the records and settings keeps the newest of each item, with deletions staying deleted. See step 2 of SYNC-PLAN.md. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loadCore, plain } = require('./helpers');
const c = loadCore(['mergeRecs', 'mergeSettings', 'mergeMarks', 'newSum', 'newEntry', 'practiceDays', 'cleanMarks', 'MAX_MARKS',
  'makeStamp', 'isStamp', 'ZERO', 'stampTime', 'sumView', 'coverage', 'okStamp', 'latestStamp', 'tieWins', 'foldRuns', 'AHEAD']);

const key = x => x.trim();
const ex = () => [{ k: 'RLRL', due: 16, within: 16 }];
const run = (id, t, extra) => Object.assign({ id, t, sec: 60, exercises: ex() }, extra);
const side = o => Object.assign({ runs: [], sums: {}, z: 0, xs: {}, x: {}, names: {}, nt: {}, nu: 1, lib: [], gone: {}, libGone: {} }, o);
const ids = l => l.map(x => x.id);
/* A stamp from device d at time t and counter n, for tests that need exact values. */
const st = (t, n, d) => c.makeStamp(t, n, d || 'aaaaaaaa');
const entry = (v, o) => Object.assign(c.newEntry(v), o);

/* A device as the app runs one: its own id, a clock that may be wrong, and a counter that only goes up (newStamp in index.html). A new
   stamp is after the stamps given (the item's version), and see moves the clock up to the latest stamp taken in (seeStamps). */
function device(id, skew) {
  let n = 0, last = 0;
  const d = { id, skew, recs: side({}), set: { set: {}, setT: {}, lists: [], listGone: {} } };
  d.stamp = (now, ...after) => {
    n++; last = Math.max(now + d.skew, last);
    after.forEach(s => { if (c.isStamp(s) && c.makeStamp(last, n, id) <= s) last = c.stampTime(s) + 1; });
    return c.makeStamp(last, n, id);
  };
  d.see = t => { last = Math.max(last, t); };
  return d;
}

test('stamps compare by time, then counter, then device, and keep rising when the clock goes back', () => {
  assert.ok(st(10, 9, 'zzzzzzzz') < st(11, 1, 'aaaaaaaa'), 'time first');
  assert.ok(st(10, 1, 'zzzzzzzz') < st(10, 2, 'aaaaaaaa'), 'then the counter');
  assert.ok(st(10, 1, 'aaaaaaaa') < st(10, 1, 'bbbbbbbb'), 'the device settles an exact tie');
  assert.ok(c.ZERO < st(0, 1), 'data from before sync loses to any real edit');
  const d = device('dddddddd', 0), a = d.stamp(1000);
  d.skew = -500;
  const b = d.stamp(1000), e = d.stamp(1000);
  assert.ok(a < b && b < e, 'the same device never goes back');
  assert.equal(c.stampTime(e), 1000);
  assert.ok(c.isStamp(a) && !c.isStamp('lq3x8k2pab12') && !c.isStamp(12345));
});

test('runs from both copies are kept once each, oldest first, with either kind of id', () => {
  const m = c.mergeRecs(side({ runs: [run('lq3x8k2pab12', 10), run(st(30, 2), 30)] }), side({ runs: [run(st(20, 1, 'bbbbbbbb'), 20), run('lq3x8k2pab12', 10)] }), key);
  assert.deepEqual(plain(ids(m.runs)), ['lq3x8k2pab12', st(20, 1, 'bbbbbbbb'), st(30, 2)]);
});

test('the newer version of a run wins, and a tie keeps the copy with stroke detail', () => {
  const m = c.mergeRecs(side({ runs: [run('a', 10, { u: st(50, 3), n: 'new' })] }), side({ runs: [run('a', 10, { n: 'old' })] }), key);
  assert.equal(m.runs[0].n, 'new');
  const sp = run('a', 10, { exercises: [{ k: 'RLRL', sp: [1, 2, 3] }] });
  const t = c.mergeRecs(side({ runs: [run('a', 10)] }), side({ runs: [sp] }), key);
  assert.equal(t.runs[0].exercises[0].sp.length, 3);
  const u = c.mergeRecs(side({ runs: [sp] }), side({ runs: [run('a', 10)] }), key);
  assert.equal(u.runs[0].exercises[0].sp.length, 3, 'whichever side it is on');
});

test('a deleted run stays deleted, unless it was restored or changed after the delete', () => {
  const m = c.mergeRecs(side({ gone: { a: st(40, 5) } }), side({ runs: [run('a', 10), run('b', 20)] }), key);
  assert.deepEqual(plain(ids(m.runs)), ['b']);
  assert.equal(m.gone.a, st(40, 5));
  const back = c.mergeRecs(side({ gone: { a: st(40, 5) } }), side({ runs: [run('a', 10, { u: st(60, 1, 'bbbbbbbb') })] }), key);
  assert.deepEqual(plain(ids(back.runs)), ['a'], 'a version newer than the delete brings it back');
  const tie = c.mergeRecs(side({ gone: { a: st(40, 5) } }), side({ runs: [run('a', 10, { u: st(40, 5) })] }), key);
  assert.deepEqual(plain(ids(tie.runs)), [], 'the delete wins a tie');
});

test('totals are kept by device: the newer copy of each, added up, and runs in them are not counted twice', () => {
  const pa = entry(st(100, 4, 'aaaaaaaa'), { runs: 2, sec: 120, days: { '2026-01-05': 120 }, cov: { aaaaaaaa: 2 } });
  const pa2 = entry(st(200, 9, 'aaaaaaaa'), { runs: 3, sec: 180, days: { '2026-01-05': 180 }, cov: { aaaaaaaa: 3 } });
  const pb = entry(st(150, 2, 'bbbbbbbb'), { runs: 1, sec: 60, days: { '2026-01-05': 60 }, ids: ['old1'] });
  const a = side({ sums: { aaaaaaaa: pa2 }, runs: [run(st(5, 5, 'aaaaaaaa'), 50)] });
  const b = side({ sums: { aaaaaaaa: pa, bbbbbbbb: pb }, runs: [run(st(3, 3, 'aaaaaaaa'), 30), run('old1', 1), run('old2', 2), run(st(4, 1, 'bbbbbbbb'), 40)] });
  const m = c.mergeRecs(a, b, key);
  assert.equal(m.sums.aaaaaaaa.runs, 3, 'the newer copy of device a\'s totals');
  assert.equal(m.sums.bbbbbbbb.runs, 1, 'device b\'s totals are kept beside them');
  const view = c.sumView(m);
  assert.equal(view.runs, 4);
  assert.deepEqual(plain(view.days), { '2026-01-05': 240 });
  assert.deepEqual(plain(ids(m.runs)), ['old2', st(4, 1, 'bbbbbbbb'), st(5, 5, 'aaaaaaaa')],
    'runs folded by counter or by old id are left out; a run only one copy had is kept');
  const old = c.coverage({ d: entry(c.ZERO, { upTo: 25 }) });
  assert.ok(old(run('x1', 20)) && !old(run('x2', 30)) && !old(run(st(10, 1), 10)), 'totals from before 1.5.231 cover old ids by time only');
});

test('a cleared history wins over an older copy, and nothing from before it comes back', () => {
  const old = side({
    runs: [run('a', 10), run(st(200, 7), 200)], sums: { aaaaaaaa: entry(st(50, 2), { runs: 9 }), bbbbbbbb: entry(st(300, 1, 'bbbbbbbb'), { runs: 1 }) },
    names: { x: 'Old', y: 'New' }, nt: { x: st(50, 3), y: st(150, 4) }, xs: { d1: [60, 30], d2: [160, 30] }
  });
  const m = c.mergeRecs(side({ z: 100 }), old, key);
  assert.equal(m.z, 100);
  assert.deepEqual(Object.keys(m.sums), ['bbbbbbbb'], 'totals folded after the clear are kept');
  assert.equal(c.sumView(m).runs, 1);
  assert.deepEqual(plain(ids(m.runs)), [st(200, 7)], 'a run after the clear is kept');
  assert.deepEqual(plain(m.names), { y: 'New' });
  assert.deepEqual(Object.keys(m.xs), ['d2']);
});

test('discarded time is counted once, whichever copies have it, and not at all once the run is back', () => {
  const xs = { d: [Date.UTC(2026, 0, 5, 12), 120] };
  const m = c.mergeRecs(side({ xs }), side({ xs: Object.assign({}, xs) }), key);
  assert.deepEqual([...c.practiceDays([], c.sumView(m)).values()], [120]);
  const back = run('d', Date.UTC(2026, 0, 5, 12), { sec: 120 });
  assert.deepEqual([...c.practiceDays([back], c.sumView(m)).values()], [120], 'a run that is both kept and discarded counts once');
});

test('names: the one set last wins, one taken off stays off, and one from before sync loses', () => {
  const m = c.mergeRecs(side({ names: { k: 'Mine' }, nt: { k: st(10, 1) } }), side({ names: { k: 'Theirs' }, nt: { k: st(20, 1, 'bbbbbbbb') } }), key);
  assert.equal(m.names.k, 'Theirs');
  const off = c.mergeRecs(side({ nt: { k: st(30, 2) } }), side({ names: { k: 'Theirs' }, nt: { k: st(20, 1, 'bbbbbbbb') } }), key);
  assert.equal(off.names.k, undefined);
  const pre = c.mergeRecs(side({ names: { k: 'Before' }, nt: { k: c.ZERO } }), side({ names: { k: 'After' }, nt: { k: st(1, 1) } }), key);
  assert.equal(pre.names.k, 'After');
});

test('saved routines: a deleted one stays deleted, and two copies of the same text become one', () => {
  const lib = (id, x, t, u) => ({ id, x, t, u });
  const m = c.mergeRecs(side({ lib: [lib('p', 'RLRL', 10, st(10, 1))], libGone: { q: st(50, 2) } }),
    side({ lib: [lib('q', 'RRLL', 20, st(20, 1, 'bbbbbbbb')), lib('r', 'RLRL ', 30, st(30, 2, 'bbbbbbbb'))] }), key);
  assert.deepEqual(plain(ids(m.lib)), ['r'], 'the newer of the two RLRL copies stays');
  assert.equal(m.libGone.p, st(30, 2, 'bbbbbbbb'), 'the other copy gets a deleted marker at the version that beat it');
});

test('deleted markers keep the newest when there are too many, and only stamps are read back', () => {
  const a = {}, b = {};
  for (let i = 0; i < c.MAX_MARKS; i++) a['a' + i] = st(i + 1, i + 1);
  b.z = st(1e9, 1);
  const m = c.mergeMarks(a, b, c.MAX_MARKS);
  assert.equal(Object.keys(m).length, c.MAX_MARKS);
  assert.equal(m.z, st(1e9, 1));
  assert.equal(m.a0, undefined, 'the oldest is dropped');
  assert.deepEqual(plain(c.cleanMarks({ x: st(5, 1), y: 'bad', z: -1, w: 5 })), { x: st(5, 1) });
});

test('fields this version does not know are kept through a merge', () => {
  const m = c.mergeRecs(side({ x: { future: 1 } }), side({ x: { other: [2] } }), key);
  assert.deepEqual(plain(m.x), { future: 1, other: [2] });
  const r = c.mergeRecs(side({ runs: [run('a', 10, { u: st(10, 1), mood: 'good' })] }), side({ runs: [run('a', 10)] }), key);
  assert.equal(r.runs[0].mood, 'good');
});

test('settings: each one changed last wins, and libraries combine by id', () => {
  const keys = ['bpm', 'tol', 'gap'];
  const a = { set: { bpm: 60, tol: 20, gap: 1 }, setT: { bpm: st(100, 5), tol: st(10, 1) }, lists: [{ id: 'k1', url: 'https://a/x.txt', u: st(5, 2) }, { id: 'k2', url: 'https://a/y.txt', u: st(5, 3) }], listGone: {} };
  const b = { set: { bpm: 80, tol: 30, gap: 2 }, setT: { bpm: st(50, 9, 'bbbbbbbb'), tol: st(90, 1, 'bbbbbbbb'), gap: st(1, 1, 'bbbbbbbb') }, lists: [{ id: 'k1', url: 'https://a/z.txt', u: st(9, 1, 'bbbbbbbb') }], listGone: { k2: st(7, 2, 'bbbbbbbb') } };
  const m = c.mergeSettings(a, b, keys);
  assert.deepEqual(plain(m.set), { bpm: 60, tol: 30, gap: 2 }, 'a setting never changed loses to one that was');
  assert.deepEqual(plain(m.lists.map(l => l.url)), ['https://a/z.txt'], 'the edited address wins and the deleted link stays gone');
});

test('two devices with clocks five minutes apart edit, delete and restore, and end up the same', () => {
  const phone = device('phone000', 0), pad = device('pad00000', -5 * 60e3);   /* the tablet's clock is five minutes slow */
  let now = Date.UTC(2026, 0, 5, 12);
  const tick = () => (now += 1000);
  const add = (d, extra) => { const r = run(d.stamp(tick()), now, extra); d.recs.runs.push(r); return r; };
  const edit = (d, id, f) => { const r = d.recs.runs.find(x => x.id === id); Object.assign(r, f, { u: d.stamp(tick(), r.u) }); };
  const del = (d, id) => { const r = d.recs.runs.find(x => x.id === id); d.recs.runs = d.recs.runs.filter(x => x.id !== id); d.recs.gone[id] = d.stamp(tick(), r.u); };
  const sync = () => {   /* each device merges the other's copy and moves its clock up to what it took in, as step 3 will */
    phone.see(c.latestStamp(pad.recs)); pad.see(c.latestStamp(phone.recs));
    const p = c.mergeRecs(phone.recs, pad.recs, key), q = c.mergeRecs(pad.recs, phone.recs, key);
    phone.recs = JSON.parse(JSON.stringify(p)); pad.recs = JSON.parse(JSON.stringify(q));
  };

  /* Both had runs from before sync, with the old ids, and the phone had folded some away before 1.5.231. */
  phone.recs.runs.push(run('lq3x8k2pab12', now - 9e5));
  phone.recs.sums.phone000 = entry(c.makeStamp(0, 0, 'phone000'), { runs: 4, sec: 240, upTo: now - 1e6 });
  pad.recs.runs.push(run('lq3x8m9qcd34', now - 8e5), run('lq0aaaaaaaaa', now - 2e6));   /* the second is older than the phone's fold */
  const p1 = add(phone), t1 = add(pad), p2 = add(phone);
  sync();
  assert.deepEqual(plain(phone.recs), plain(pad.recs), 'the same after the first sync');
  assert.equal(phone.recs.runs.length, 5, 'both old runs and three new ones; the pad\'s run from before the phone\'s fold counts as folded');
  assert.equal(c.sumView(phone.recs).runs, 4);

  /* Offline, the phone edits a run and a second later the pad edits it too. The pad's clock is five minutes slow, so its edit has the
     older time: the faster clock wins a close call, as SYNC-PLAN.md says, but the same way on both devices. */
  edit(phone, t1.id, { n: 'phone' });
  edit(pad, t1.id, { n: 'pad' });
  del(pad, p1.id);
  add(pad);
  sync();
  assert.equal(phone.recs.runs.find(r => r.id === t1.id).n, 'phone', 'the edit with the later stamp wins');
  assert.deepEqual(plain(phone.recs), plain(pad.recs));
  assert.ok(!phone.recs.runs.some(r => r.id === p1.id), 'the delete reaches the phone');

  /* After the sync the pad, with its slow clock, edits the same run again. Its clock moved up to the phone's edit, so its edit is later. */
  edit(pad, t1.id, { n: 'pad again' });
  sync();
  assert.equal(phone.recs.runs.find(r => r.id === t1.id).n, 'pad again', 'an edit made after seeing another wins, however slow the clock');

  /* The phone restores the deleted run (Undo or import), with a new version, and the pad deletes another. */
  const back = Object.assign(JSON.parse(JSON.stringify(p1)), { u: phone.stamp(tick()) });
  delete phone.recs.gone[p1.id]; phone.recs.runs.push(back);
  del(pad, p2.id);
  sync();
  assert.deepEqual(plain(phone.recs), plain(pad.recs), 'the same after the second sync');
  assert.ok(phone.recs.runs.some(r => r.id === p1.id), 'the restore is newer than the delete');
  assert.ok(!phone.recs.runs.some(r => r.id === p2.id));

  /* The pad folds its oldest runs into its own totals (foldRuns): the two old ids and its own runs, all on one day. The phone's run stays
     for the phone to fold. The phone keeps its copies of the pad's runs until it syncs. */
  const total = d => d.recs.runs.length + c.sumView(d.recs).runs;
  const before = total(phone);
  const pe = c.foldRuns(pad.recs, 'pad00000', pad.recs.runs.length - 3);
  pe.v = pad.stamp(tick(), pe.v);
  assert.deepEqual(plain(ids(pad.recs.runs)), [p1.id], 'only the phone\'s run is left');
  sync();
  assert.deepEqual(plain(phone.recs), plain(pad.recs), 'the same after the fold');
  assert.equal(total(phone), before, 'no run is lost or counted twice by the fold');
  assert.equal(c.sumView(phone.recs).runs, 8, 'the phone\'s totals from before sync and the pad\'s new ones, added up');

  /* Then the phone folds its own run, and the two folds add up. */
  const qe = c.foldRuns(phone.recs, 'phone000', 0);
  qe.v = phone.stamp(tick(), qe.v);
  sync();
  assert.deepEqual(plain(phone.recs), plain(pad.recs));
  assert.equal(phone.recs.runs.length, 0);
  assert.equal(c.sumView(phone.recs).runs, before, 'every run counted once');
});

test('a device folds only its own runs and old ids; others lose only their stroke detail', () => {
  const day = Date.UTC(2026, 0, 5, 12), me = 'aaaaaaaa', other = 'bbbbbbbb';
  const sp = () => [{ k: 'RLRL', due: 16, within: 16, sp: [1, 2, 3] }];
  const r = side({
    runs: [run('lq3x8k2pab12', day - 3 * 864e5, { exercises: sp() }), run(st(day - 2 * 864e5, 1, other), day - 2 * 864e5, { exercises: sp() }),
      run(st(day - 864e5, 2), day - 864e5, { exercises: sp() }), run(st(day, 5), day, { exercises: sp() })],
    xs: { [st(day - 864e5, 3)]: [day - 864e5, 30], [st(day - 864e5, 8, other)]: [day - 864e5, 40] }
  });
  const e = c.foldRuns(r, me, 2);
  assert.deepEqual(plain(ids(r.runs)), [st(day - 2 * 864e5, 1, other), st(day, 5)], 'the old id and this device\'s oldest are folded');
  assert.equal(e.runs, 2);
  assert.ok(!r.runs[0].exercises[0].sp, 'another device\'s old run loses its stroke detail');
  assert.ok(r.runs[1].exercises[0].sp, 'a newer run keeps it');
  assert.equal(e.cov[me], 3, 'this device\'s discarded run is folded too');
  assert.ok(!e.cov[other] && !e.ids.includes(st(day - 864e5, 8, other)), 'nothing of the other device\'s is covered');
  assert.deepEqual(Object.keys(r.xs), [st(day - 864e5, 8, other)], 'the other device\'s discarded time stays for it');
  assert.equal(Object.values(e.days).reduce((x, y) => x + y, 0), 60 + 60 + 30);
  assert.equal(c.foldRuns(side({ runs: [run(st(1, 1, other), 1)] }), me, 0), null, 'none of its own: nothing to fold');
});

test('a stamp more than a day ahead is not believed', () => {
  const now = Date.now(), ahead = st(now + 2 * c.AHEAD, 1, 'bbbbbbbb'), soon = st(now + c.AHEAD / 2, 1, 'bbbbbbbb');
  assert.ok(!c.okStamp(ahead) && c.okStamp(soon));
  assert.deepEqual(plain(c.cleanMarks({ a: ahead, b: soon })), { b: soon }, 'a marker from a clock far ahead is dropped');
  assert.equal(c.latestStamp({ runs: [{ id: ahead }, { id: soon }] }), c.stampTime(soon), 'and the clock does not move up to it');
});

test('the latest stamp is found in ids, versions, markers and totals', () => {
  const s = t => st(t, 1, 'bbbbbbbb');
  assert.equal(c.latestStamp({ runs: [{ id: s(5), u: s(7) }], lib: [{ id: 'x', u: s(3) }] }), 7);
  assert.equal(c.latestStamp({ gone: { a: s(9) } }, { nt: { k: s(4) } }), 9);
  assert.equal(c.latestStamp({ sums: { bbbbbbbb: { v: s(11) } }, setT: { bpm: s(10) } }), 11);
  assert.equal(c.latestStamp({ runs: [{ id: 'lq3x8k2pab12' }] }), 0, 'old ids carry no stamp');
});

test('two devices with different data from before sync settle every tie the same way, whichever merges', () => {
  const a = side({ runs: [run('lq3x8k2pab12', 10, { n: 'a' })], names: { k: 'Paradiddles' }, nt: { k: c.ZERO },
    lib: [{ id: 'l1', x: 'RLRR LRLL', t: 5 }], sums: { aaaaaaaa: entry(st(0, 0), { runs: 2 }) } });
  const b = side({ runs: [run('lq3x8k2pab12', 10, { n: 'b' })], names: { k: 'Doubles' }, nt: { k: c.ZERO },
    lib: [{ id: 'l1', x: 'RRLL', t: 5 }], sums: { aaaaaaaa: entry(st(0, 0), { runs: 3 }) } });
  assert.deepEqual(plain(c.mergeRecs(a, b, key)), plain(c.mergeRecs(b, a, key)), 'records');
  const sa = { set: { bpm: 60, tol: 20 }, setT: {}, lists: [{ id: 'q', url: 'https://a.example/r.txt' }], listGone: {} };
  const sb = { set: { bpm: 80 }, setT: {}, lists: [{ id: 'q', url: 'https://b.example/r.txt' }], listGone: {} };
  const ks = ['bpm', 'tol'];
  assert.deepEqual(plain(c.mergeSettings(sa, sb, ks)), plain(c.mergeSettings(sb, sa, ks)), 'settings');
  assert.equal(c.mergeSettings(sb, sa, ks).set.tol, 20, 'a value wins over none');
  assert.ok(c.tieWins(1, undefined) && !c.tieWins(undefined, 1));
});
