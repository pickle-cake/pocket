/* Turns a Pocket records export into tests/fixtures/seed-records.json, the history the browser checks start with.
   The repository uses no book content, so a routine that is not one of routines/*.txt has every line replaced
   (its order is content too, even where a line is also a rudiment), and so does a single exercise that is not
   a line of routines/*.txt: each R or L
   becomes another R or L, chosen from the line itself, and note codes, flams, drags, rests and stroke counts
   stay as they are, so the timings still fit. Settings and library links are left out.
   Usage: node tests/fixtures/make-seed.js path/to/pocket-records-YYYYMMDD.json */
const fs = require('fs'), path = require('path');
const { loadCore, ROOT, read } = require('../helpers');
const c = loadCore(['parseRoutine', 'resolveExercises', 'patKey', 'textKey']);
const OUT = path.join(__dirname, 'seed-records.json');

const src = process.argv[2];
if (!src) { console.log('usage: node tests/fixtures/make-seed.js <export.json>'); process.exit(1); }
const o = JSON.parse(fs.readFileSync(src, 'utf8'));
if (o.v !== 2) throw new Error('expected a version 2 export, got v=' + o.v);
const items = o.items || {}, text = k => items[k];

/* The exercise keys of a routine, in order, as the app makes them. */
const keysOf = t => {
  const p = c.parseRoutine(t);
  if (!p.exercises.length) return [];
  return c.resolveExercises(p.exercises, { unit: 'pass', v: 1 }, { bpm: 60, subdiv: 4 }).map(b => c.patKey(b.notes, b.groupStart, b.subs, b.defSub, b.sig));
};

/* What the repository already holds: every line, routine title and exercise key in routines/*.txt. */
const HEADER = /^\s*[a-z]+\s*:/i;
const known = { lines: new Set(), titles: new Set(), keys: new Set(), routines: new Set() };
const body = t => t.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !/^title\s*:/i.test(l)).join('\n');
for (const f of fs.readdirSync(path.join(ROOT, 'routines')).filter(f => f.endsWith('.txt')))
  for (const s of read('routines/' + f).split(/^[-—–]{3,}\s*$/m).slice(1)) {
    const t = (/^\s*title\s*:\s*(.*)$/mi.exec(s) || [])[1];
    if (t) known.titles.add(t.trim());
    known.routines.add(body(s));
    s.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !HEADER.test(l)).forEach(l => known.lines.add(l));
    s.split('\n').filter(l => l.trim() && !l.trim().startsWith('#') && !HEADER.test(l)).forEach(l => keysOf(l.trim()).forEach(k => known.keys.add(k)));
  }

/* A new sticking for a line: same tokens, each R or L drawn from a hash of the line (and a salt, on a clash). */
const hash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const used = new Set(known.lines), lineMap = new Map();
function newLine(l, all) {
  if (!all && known.lines.has(l)) return l;
  if (lineMap.has(l)) return lineMap.get(l);
  for (let salt = 0; ; salt++) {
    let h = hash(l + '#' + salt);
    const n = l.replace(/[RL]/g, () => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return h & 1 ? 'R' : 'L'; });
    if (n !== l && !used.has(n)) { used.add(n); lineMap.set(l, n); return n; }
  }
}
const isLine = s => s && !s.startsWith('#') && !HEADER.test(s);
const newText = t => {
  if (known.routines.has(body(t))) return t;
  const all = t.trim().includes('\n');
  return t.split('\n').map(l => { const s = l.trim(); return isLine(s) ? l.replace(s, newLine(s, all)) : l; }).join('\n');
};

/* Old exercise key -> new, paired by position in each routine and line that holds them. */
const keyMap = new Map(), rkMap = new Map();
function mapRoutine(t) {
  const n = newText(t);
  const a = keysOf(t), b = keysOf(n);
  if (a.length === b.length) a.forEach((k, i) => keyMap.has(k) || keyMap.set(k, b[i]));
  return n;
}
const texts = new Map();   /* old text -> new text, for routines and library entries */
const remap = t => { if (!texts.has(t)) texts.set(t, mapRoutine(t)); return texts.get(t); };

for (const r of o.runs || []) {
  if (r.rp && text(r.rp.x)) {
    const t = text(r.rp.x), n = remap(t), old = c.textKey(t);
    if (old && old === r.rk) rkMap.set(r.rk, c.textKey(n));
  }
}
for (const e of o.lib || []) if (text(e.x)) remap(text(e.x));

/* Re-pack with fresh item ids. */
const outItems = {}, ids = new Map();
const put = t => { if (!ids.has(t)) { const id = 's' + ids.size.toString(36); ids.set(t, id); outItems[id] = t; } return ids.get(t); };
const newKey = k => keyMap.get(k) || (known.keys.has(k) ? k : null);
const dropped = [];
const runs = (o.runs || []).map(r => {
  const exercises = r.exercises.map(b => { const k = newKey(text(b.k)); if (!k) dropped.push(text(b.k)); return k && Object.assign({}, b, { k: put(k) }); }).filter(Boolean);
  const out = Object.assign({}, r, { exercises, rk: rkMap.get(r.rk) || r.rk });
  if (r.sk) out.sk = r.sk.map(b => { const k = newKey(text(b.k)); return k && { i: b.i, k: put(k) }; }).filter(Boolean);
  if (r.rp) out.rp = Object.assign({}, r.rp, { x: put(remap(text(r.rp.x))) });
  return out;
});
/* Totals: one set before 1.5.231 (format 2), one for each device after (format 3). */
const cleanTotals = q => {
  const s = Object.assign({}, q);
  s.pat = (q.pat || []).map(e => { const k = newKey(text(e.k)); return k && Object.assign({}, e, { k: put(k) }); }).filter(Boolean);
  s.rt = {};
  for (const [key, e] of Object.entries(q.rt || {})) { const rk = rkMap.get(e.rk) || e.rk; s.rt[key.replace(e.rk, rk)] = Object.assign({}, e, { rk }); }
  return s;
};
const totals = {};
if (o.sums) { totals.sums = {}; for (const [d, q] of Object.entries(o.sums)) totals.sums[d] = cleanTotals(q); for (const k of ['z', 'xs']) if (o[k] !== undefined) totals[k] = o[k]; }
else if (o.sum) totals.sum = cleanTotals(o.sum);
const lib = (o.lib || []).filter(e => text(e.x)).map(e => ({ id: e.id, x: put(remap(text(e.x))), t: e.t }));
const names = {};
for (const [k, v] of Object.entries(o.names || {})) if (known.titles.has(v)) names[k] = v;

const seed = Object.assign({ v: o.sums ? 3 : 2 }, totals, { lib, names, nu: o.nu, runs, items: outItems });

/* Nothing outside routines/*.txt may survive: a routine is one of the repository's or has only generated lines,
   and a single exercise is a repository line, a generated one, or a key made from one. */
const generated = new Set(lineMap.values()), newKeys = new Set(keyMap.values());
for (const t of Object.values(outItems)) {
  const lines = t.split('\n').map(s => s.trim()).filter(isLine);
  const ok = t.trim().includes('\n') ? known.routines.has(body(t)) || lines.every(l => generated.has(l))
    : lines.every(l => known.lines.has(l) || generated.has(l) || known.keys.has(l) || newKeys.has(l));
  if (!ok) throw new Error('unreplaced content in the seed: ' + t.slice(0, 80));
}

fs.writeFileSync(OUT, JSON.stringify(seed) + '\n');
console.log('wrote ' + path.relative(ROOT, OUT) + ': ' + runs.length + ' runs, ' + lib.length + ' library entries, ' + lineMap.size + ' stickings replaced' + (dropped.length ? ', ' + dropped.length + ' exercises dropped' : ''));
