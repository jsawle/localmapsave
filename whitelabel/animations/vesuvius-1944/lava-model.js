// Lava flow model: DOWNFLOW-style probabilistic steepest descent with pit filling.
// Identical to the model in the Vesuvius 1944 lava page (lava model v1.0), packaged as an ES module.
const __root = {};
(function (root) {
  "use strict";

  // Deterministic noise in [-1, 1] for (run, cell).
  function noise(run, idx, seed) {
    let h = (Math.imul(run + 1, 0x9E3779B1) ^ Math.imul(idx + 1, 0x85EBCA77) ^ seed) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846CA68B) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 2147483647.5 - 1;
  }

  const DI = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DJ = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    const K = this.k, V = this.v; K.push(key); V.push(val); let i = K.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1; if (K[p] <= K[i]) break;
      [K[p], K[i]] = [K[i], K[p]]; [V[p], V[i]] = [V[i], V[p]]; i = p;
    }
  };
  Heap.prototype.pop = function () {
    const K = this.k, V = this.v; const tk = K[0], tv = V[0];
    const lk = K.pop(), lv = V.pop();
    if (K.length) {
      K[0] = lk; V[0] = lv; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < K.length && K[l] < K[m]) m = l;
        if (r < K.length && K[r] < K[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]]; [V[m], V[i]] = [V[i], V[m]]; i = m;
      }
    }
    this.lastKey = tk; return tv;
  };
  Heap.prototype.size = function () { return this.k.length; };

  /* Fill the hollow containing `start` on surface Z(idx) until it spills.
     Returns { outlet, pond:[idx], level } or { capped:true } / { edge:true, outlet }. */
  function fillHollow(Z, valid, w, ht, start, maxCells) {
    const seen = new Set([start]);
    const heap = new Heap();
    heap.push(Z(start), start);
    let level = -Infinity;
    const pond = [];
    while (heap.size()) {
      const c = heap.pop(); const hc = heap.lastKey;
      if (hc < level) return { outlet: c, pond, level };
      level = hc; pond.push(c);
      if (pond.length > maxCells) return { capped: true, pond, level };
      const ci = c % w, cj = (c / w) | 0;
      for (let k = 0; k < 8; k++) {
        const ni = ci + DI[k], nj = cj + DJ[k];
        if (ni < 0 || nj < 0 || ni >= w || nj >= ht) return { edge: true, outlet: c, pond, level };
        const n = nj * w + ni;
        if (seen.has(n) || !valid(n)) continue;
        seen.add(n); heap.push(Z(n), n);
      }
    }
    return { capped: true, pond, level };
  }

  /* One lava path. dh = 0 gives the unperturbed "most likely" path.
     onCell(idx, step, isPond) is called for every cell covered (path + filled hollows). */
  function descend(h, w, ht, start, run, dh, seed, cellTrue, maxLen, maxPond, onCell, stopElev) {
    stopElev = stopElev == null ? -Infinity : stopElev;
    const raised = new Map();                // cells filled with lava in this run → lava surface height
    const base = (i) => h[i] + (dh ? dh * noise(run, i, seed) : 0);
    const Z = (i) => { const r = raised.get(i); return r === undefined ? base(i) : r; };
    const valid = (i) => isFinite(h[i]);
    const ponds = [];
    let cur = start, step = 0, len = 0, reason = "flat";
    onCell(cur, 0);
    for (let guard = 0; guard < 100000; guard++) {
      if (h[cur] <= 0) { reason = "sea"; break; }
      if (step > 0 && h[cur] < stopElev) { reason = "height"; break; }
      const ci = cur % w, cj = (cur / w) | 0;
      const zc = Z(cur);
      let best = -1, bestSlope = 0, bestD = 1, hitEdge = false;
      for (let k = 0; k < 8; k++) {
        const ni = ci + DI[k], nj = cj + DJ[k];
        if (ni < 0 || nj < 0 || ni >= w || nj >= ht) { hitEdge = true; continue; }
        const n = nj * w + ni;
        if (!valid(n)) continue;
        const s = (zc - Z(n)) / DD[k];
        if (s > bestSlope) { bestSlope = s; best = n; bestD = DD[k]; }
      }
      if (best < 0) {
        if (hitEdge) { reason = "edge"; break; }
        const f = fillHollow(Z, valid, w, ht, cur, maxPond);
        if (f.capped) { reason = "flat"; break; }
        const lvl = f.level + 0.01;
        for (const c of f.pond) { if (!raised.has(c)) onCell(c, step, true); raised.set(c, lvl); }
        ponds.push({ cells: f.pond, level: f.level, outlet: f.outlet });
        if (f.edge) { reason = "edge"; break; }
        const d = Math.hypot((f.outlet % w) - ci, ((f.outlet / w) | 0) - cj) * cellTrue;
        if (len + d > maxLen) { reason = "length"; break; }
        len += d; cur = f.outlet; step++;
        onCell(cur, step);
        continue;
      }
      if (len + bestD * cellTrue > maxLen) { reason = "length"; break; }
      len += bestD * cellTrue; cur = best; step++;
      onCell(cur, step);
    }
    return { end: cur, steps: step, length: len, reason, ponds };
  }

  /* opts: h (Float32Array heights in m, NaN = no data, <=0 = sea), w, ht,
     cellTrue (m per cell), vent (idx), runs, dh (m), maxLen (m), seed,
     stopElev (m, optional: a flow ends once it drops below this height),
     width (m, optional: each path is widened to this footprint before counting — real flows are tens to hundreds of metres wide),
     targets: [{name, cells:Int32Array}] */
  // Incremental runner: call step(n) repeatedly (lets a page yield between batches), then result().
  function createRunner(opts) {
    const { h, w, ht, cellTrue, vent } = opts;
    const runs = opts.runs | 0, dh = +opts.dh, maxLen = +opts.maxLen, seed = (opts.seed | 0) >>> 0;
    const maxPond = opts.maxPond || 4000;
    const N = w * ht;
    const count = new Int32Array(N);
    const first = new Int32Array(N).fill(-1);
    const targets = (opts.targets || []).map(t => {
      const m = new Uint8Array(N); for (const c of t.cells) m[c] = 1;
      return { name: t.name, mask: m, hits: 0 };
    });
    const lengths = [], reasons = { sea: 0, edge: 0, flat: 0, length: 0, height: 0 };
    const seenRun = new Int32Array(N).fill(-1);
    const stopElev = opts.stopElev == null ? -Infinity : +opts.stopElev;
    const rad = Math.max(0, (+opts.width || 0) / 2 / cellTrue);
    const offs = [];                                   // disc of cells around each path cell
    const R = Math.floor(rad);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if (di * di + dj * dj <= rad * rad + 1e-9) offs.push([di, dj]);
    if (!offs.length) offs.push([0, 0]);
    let done = 0;

    function step(n) {
      const end = Math.min(runs, done + n);
      for (let r = done; r < end; r++) {
        const hit = new Uint8Array(targets.length);
        const mark = (c, s) => {
          if (seenRun[c] === r) return; seenRun[c] = r;
          count[c]++;
          if (first[c] < 0 || s < first[c]) first[c] = s;
          for (let t = 0; t < targets.length; t++) if (targets[t].mask[c]) hit[t] = 1;
        };
        const res = descend(h, w, ht, vent, r, dh, seed, cellTrue, maxLen, maxPond, (c, s) => {
          const ci = c % w, cj = (c / w) | 0;
          for (const [di, dj] of offs) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= w || nj >= ht) continue;
            const n = nj * w + ni;
            if (h[n] > 0) mark(n, s);                  // footprint doesn't spread onto the sea
          }
        }, stopElev);
        for (let t = 0; t < targets.length; t++) targets[t].hits += hit[t];
        lengths.push(res.length); reasons[res.reason]++;
      }
      done = end;
      return done;
    }

    function result() {
      const best = [];
      const bestRes = descend(h, w, ht, vent, 0, 0, seed, cellTrue, maxLen, maxPond, (c, s, pond) => { if (!pond) best.push(c); }, stopElev);
      const L = lengths.slice().sort((a, b) => a - b);
      let covered = 0; for (let i = 0; i < N; i++) if (count[i] > 0) covered++;
      return {
        count, first, runs: done,
        bestPath: best, bestPathLength: bestRes.length, bestPonds: bestRes.ponds, bestReason: bestRes.reason,
        medianLength: L[L.length >> 1] || 0, maxLength: L[L.length - 1] || 0,
        reasons, coveredCells: covered,
        targets: targets.map(t => ({ name: t.name, hits: t.hits, fraction: done ? t.hits / done : 0 }))
      };
    }
    return { step, result, get done() { return done; }, runs };
  }

  function run(opts) { const r = createRunner(opts); r.step(r.runs); return r.result(); }

  const api = { run, createRunner, descend, fillHollow, noise };
  root.LavaModel = api;
})(__root);
export const LavaModel = __root.LavaModel;
