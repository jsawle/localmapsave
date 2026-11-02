// Small geometry helpers for building and checking the test hand-ins (longitude, latitude in degrees).
export const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;

export function km(a, b) {
  const [lo1, la1] = a.map(rad), [lo2, la2] = b.map(rad);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Distance from point p to segment ab, in km (equirectangular around p: fine at these scales)
export function kmToSegment(p, a, b) {
  const k = Math.cos(rad(p[1]));
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  let t = len ? -(ax * dx + ay * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy) * (Math.PI / 180) * R_KM;
}

export function kmToLine(p, paths) {
  let best = Infinity;
  for (const path of paths) for (let i = 1; i < path.length; i++) best = Math.min(best, kmToSegment(p, path[i - 1], path[i]));
  return best;
}

export function lineLengthKm(path) { let s = 0; for (let i = 1; i < path.length; i++) s += km(path[i - 1], path[i]); return s; }

// Chain a trail's pieces into one route from `from` to `to` (greedy: always the nearest unused piece end)
export function chainRoute(paths, from, to, maxGapKm = 60) {
  const pieces = paths.map((p) => p.slice());
  const near = (pt) => { let bi = -1, rev = false, bd = Infinity;
    pieces.forEach((p, i) => { if (!p) return; const d0 = km(pt, p[0]), d1 = km(pt, p[p.length - 1]);
      if (d0 < bd) { bd = d0; bi = i; rev = false; } if (d1 < bd) { bd = d1; bi = i; rev = true; } }); return { bi, rev, bd }; };
  // start: the piece with a vertex nearest `from`
  let route = [], cur = from;
  for (let guard = 0; guard < pieces.length; guard++) {
    const { bi, rev, bd } = near(cur);
    if (bi < 0 || (route.length && bd > maxGapKm)) break;   // a bigger gap means a branch, not the next piece
    const p = rev ? pieces[bi].slice().reverse() : pieces[bi];
    pieces[bi] = null;
    route = route.concat(route.length ? p.slice(1) : p);
    cur = route[route.length - 1];
    if (km(cur, to) < 15) break;
  }
  return route;
}

// Douglas-Peucker simplification to a tolerance in km
export function simplify(path, tolKm) {
  if (path.length < 3) return path.slice();
  let idx = -1, dmax = 0;
  for (let i = 1; i < path.length - 1; i++) { const d = kmToSegment(path[i], path[0], path[path.length - 1]); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= tolKm) return [path[0], path[path.length - 1]];
  return simplify(path.slice(0, idx + 1), tolKm).slice(0, -1).concat(simplify(path.slice(idx), tolKm));
}

// Repeatable "random" numbers, so the files come out the same every run
export function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Move a point by up to maxKm in a random direction
export function jitter(pt, maxKm, rnd) {
  const d = (0.3 + 0.7 * rnd()) * maxKm, a = rnd() * 2 * Math.PI;
  return [pt[0] + (d * Math.sin(a)) / (111.32 * Math.cos(rad(pt[1]))), pt[1] + (d * Math.cos(a)) / 110.57];
}

// Share of a student's line that lies within tolKm of the answer route (sampled every ~5 km)
export function shareNear(studentPath, answerPaths, tolKm) {
  let near = 0, all = 0;
  for (let i = 1; i < studentPath.length; i++) {
    const a = studentPath[i - 1], b = studentPath[i], n = Math.max(1, Math.ceil(km(a, b) / 5));
    for (let j = 0; j < n; j++) { const t = (j + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      all++; if (kmToLine(p, answerPaths) <= tolKm) near++; }
  }
  return all ? near / all : 0;
}
