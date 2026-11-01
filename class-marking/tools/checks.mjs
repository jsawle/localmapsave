// Checks a hand-in (.amap file as written by Atlas) against an assignment key. Plain ES module with no
// dependencies, so the same code can run in Node (tests) and in the browser (the marking app).
// CHECKS_VERSION: bump when the maths or matching rules change.
import { km, kmToLine, shareNear, lineLengthKm } from "./geo.mjs";
export const CHECKS_VERSION = "0.1";

const R = 6378137;
const toLonLat = ([x, y]) => [(x / R) * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
const isMerc = (g) => !g.spatialReference || [102100, 3857, 102113].includes(g.spatialReference.wkid);
const conv = (g, c) => (isMerc(g) ? toLonLat(c) : [c[0], c[1]]);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** What's in a hand-in: its sketches as plain points and lines in degrees, its layers, and whether it's locked. */
export function readHandIn(raw) {
  const out = { locked: raw && raw.atlasLocked === true, points: [], lines: [], areas: [], layers: [], basemap: (raw.baseMap && raw.baseMap.title) || "" };
  for (const op of raw.operationalLayers || []) {
    const id = String(op.id || "");
    if (!id.startsWith("__sketch_")) { out.layers.push(op.title || id); continue; }
    for (const lyr of (op.featureCollection && op.featureCollection.layers) || []) {
      for (const f of (lyr.featureSet && lyr.featureSet.features) || []) {
        const g = f.geometry || {}, a = f.attributes || {};
        const base = { title: a.title || "", description: a.description || "", color: a.color || "", kind: a.kind || "" };
        if (Number.isFinite(g.x)) out.points.push({ ...base, lonlat: conv(g, [g.x, g.y]) });
        else if (g.paths) out.lines.push({ ...base, paths: g.paths.map((p) => p.map((c) => conv(g, c))) });
        else if (g.rings) out.areas.push({ ...base, rings: g.rings.map((r) => r.map((c) => conv(g, c))) });
      }
    }
  }
  return out;
}

// Levenshtein distance, for names spelled the way they sound (Pinatoobo, Kilawea)
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Does the text name this place? Exact words first, then close misspellings (up to 1 letter in 4 wrong). */
export function mentions(text, names) {
  const t = norm(text), words = t.split(/[^a-z0-9]+/).filter(Boolean);
  return names.some((n) => {
    const nn = norm(n);
    if (t.includes(nn)) return true;
    const k = nn.split(/[^a-z0-9]+/).filter(Boolean).length, allow = Math.max(1, Math.floor(nn.replace(/[^a-z0-9]/g, "").length / 4));
    if (nn.length < 4) return false;
    for (let i = 0; i + k <= words.length; i++) if (lev(words.slice(i, i + k).join(" "), nn.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()) <= allow) return true;
    return false;
  });
}
function factResult(text, fact) {
  const t = norm(text);
  if (!t.trim()) return null;
  if ((fact.right || []).some((r) => new RegExp(r, "i").test(t))) return true;
  if ((fact.wrong || []).some((r) => new RegExp(r, "i").test(t))) return false;
  return null;   // not mentioned, or can't tell: for the teacher
}

/** Compare a hand-in with the key. Returns facts for the teacher, not a mark. */
export function assess(h, key) {
  const pts = h.points.map((p, i) => ({ ...p, i, used: false }));
  const places = key.places.map((pl) => {
    // the student's point nearest this place, if within the tolerance
    let best = null;
    for (const p of pts) { const d = km(p.lonlat, pl.lonlat); if (!best || d < best.d) best = { p, d }; }
    return { pl, best };
  });
  // nearest first, each point used once
  const order = places.map((x, i) => i).sort((a, b) => (places[a].best ? places[a].best.d : 1e9) - (places[b].best ? places[b].best.d : 1e9));
  const result = new Array(places.length);
  for (const i of order) {
    const { pl } = places[i];
    let best = null;
    for (const p of pts) { if (p.used) continue; const d = km(p.lonlat, pl.lonlat); if (!best || d < best.d) best = { p, d }; }
    const found = !!best && best.d <= pl.toleranceKm;
    if (found) best.p.used = true;
    const text = found ? (best.p.title + "\n" + best.p.description) : "";
    result[i] = {
      name: pl.name, found, km: best ? Math.round(best.d) : null,
      title: found ? best.p.title : "", text: found ? best.p.description : "",
      named: found ? mentions(best.p.title + " " + best.p.description, pl.names) : false,
      facts: Object.fromEntries((pl.facts || []).map((f) => [f.id, found ? factResult(text, f) : null]))
    };
  }
  const unmatched = pts.filter((p) => !p.used);
  const notes = unmatched.filter((p) => (p.title + p.description).trim()).map((p) => ({ title: p.title, text: p.description }));
  // a place not found on the map but named in a note (a student who couldn't place points, say)
  for (const r of result) {
    const pl = key.places.find((x) => x.name === r.name);
    if (r.found) continue;
    // a point named like this place but too far away (put in the wrong place), or the place named in a written note
    const far = unmatched.find((p) => mentions(p.title, pl.names));
    if (far) r.namedButFarKm = Math.round(km(far.lonlat, pl.lonlat));
    r.inNote = unmatched.some((p) => p !== far && (p.title + p.description).trim() && mentions(p.title + " " + p.description, pl.names));
  }
  const out = { checksVersion: CHECKS_VERSION, locked: h.locked, places: result,
    placesFound: result.filter((r) => r.found).length, emptyPopups: h.points.filter((p) => !(p.title + p.description).trim()).length,
    notes, layers: h.layers, missingLayers: (key.layers || []).filter((l) => !h.layers.includes(l)) };
  if (key.route) {
    const lines = h.lines.flatMap((l) => l.paths);
    if (!lines.length) out.route = { drawn: false };
    else {
      const all = lines.flat();
      const start = all.reduce((m, p) => Math.min(m, km(p, key.route.start)), Infinity);
      const end = all.reduce((m, p) => Math.min(m, km(p, key.route.end)), Infinity);
      const share = lines.reduce((s, p) => s + shareNear(p, key.route.paths, key.route.toleranceKm) * lineLengthKm(p), 0) / lines.reduce((s, p) => s + lineLengthKm(p), 0);
      const reach = Math.max(...key.route.checkpoints.map((c, i) => (all.some((p) => km(p, c.lonlat) <= key.route.toleranceKm) ? i + 1 : 0)));
      out.route = { drawn: true, lengthKm: Math.round(lines.reduce((s, p) => s + lineLengthKm(p), 0)), shareOnRoute: Math.round(share * 100) / 100,
        startKm: Math.round(start), endKm: Math.round(end), reachesCheckpoint: reach ? key.route.checkpoints[reach - 1].name : null };
    }
  }
  return out;
}
