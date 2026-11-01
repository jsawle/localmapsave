// Turning a teacher's answer map into a key, naming students from file names, and the class export.
// Plain ES module (Node tests and the browser). KEYS_VERSION: bump when these rules change.
import { readHandIn } from "./checks.mjs";
import { km, kmToLine } from "./geo.mjs";
export const KEYS_VERSION = "0.2";   // 0.2: export numbers a student's hand-ins alike and counts them

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Other ways a place's title may be written: "Mount Fuji (Fujisan)" -> mount fuji, fujisan, fuji. */
export function namesFor(title) {
  const t = norm(title), out = new Set();
  if (!t) return [];
  out.add(t);
  const paren = t.match(/\(([^)]+)\)/);
  const bare = t.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (bare) out.add(bare);
  if (paren) out.add(paren[1].trim());
  const noPrefix = bare.replace(/^(mount|mt\.?|monte|mont|lake|river|the)\s+/, "");
  if (noPrefix && noPrefix !== bare && noPrefix.length >= 4) out.add(noPrefix);
  const beforeComma = bare.split(",")[0].trim();
  if (beforeComma && beforeComma !== bare && beforeComma.length >= 4) out.add(beforeComma);
  return [...out];
}

/** A key from the teacher's answer map: its points are the places, its longest line the route. */
export function keyFromAnswerMap(raw, opts = {}) {
  const placeKm = opts.placeKm || 50, routeKm = opts.routeKm || 50;
  const h = readHandIn(raw);
  const skip = new Set(opts.skip || []);   // points the teacher says aren't places (a model note, say)
  const places = h.points.map((p, i) => ({ id: "p" + i, name: p.title || "Point " + (i + 1), names: namesFor(p.title), lonlat: p.lonlat,
    toleranceKm: placeKm, answer: p.description, facts: [] })).filter((p, i) => !skip.has(i));
  const key = { id: opts.id || "answer-map", title: opts.title || "", layers: h.layers.slice(), places,
    answerNotes: h.points.filter((p, i) => skip.has(i)).map((p) => ({ title: p.title, text: p.description })) };
  const lines = h.lines.flatMap((l) => l.paths);
  if (lines.length) {
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
    const start = longest[0], end = longest[longest.length - 1];
    // the places along the route, in order, are its checkpoints
    const along = places.filter((p) => kmToLine(p.lonlat, [longest]) <= routeKm).map((p) => {
      let bi = 0, bd = Infinity; longest.forEach((v, i) => { const d = km(v, p.lonlat); if (d < bd) { bd = d; bi = i; } }); return { name: p.name, lonlat: p.lonlat, at: bi };
    }).sort((a, b) => a.at - b.at).map(({ name, lonlat }) => ({ name, lonlat }));
    if (!along.length || km(along[along.length - 1].lonlat, end) > routeKm) along.push({ name: "end of the route", lonlat: end });
    key.route = { name: "Route", toleranceKm: routeKm, start, end, paths: lines, checkpoints: along };
  }
  return key;
}

/** "Volcanoes - Jordan (2)_locked.amap" -> { student: "Jordan", copy: 2 } */
export function studentFromFile(name) {
  let base = String(name || "").replace(/\.(amap|mmap|json)$/i, "").replace(/[_ ]locked$/i, "").trim();
  let copy = 1;
  const m = base.match(/\s*\((\d+)\)$/); if (m) { copy = Number(m[1]); base = base.slice(0, m.index).trim(); }
  const parts = base.split(/\s+[-–]\s+/);
  const student = (parts.length > 1 ? parts[parts.length - 1] : base).trim() || name;
  return { student, copy };
}

const cell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // spreadsheet programs would run these as formulas
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** Plain words for a place's result, used in the app and the export. */
export function placeStatus(p) {
  if (p.found) return "Marked (" + p.km + " km away)";
  if (p.namedButFarKm) return "Named, but " + p.namedButFarKm + " km away";
  if (p.inNote) return "Named in a note";
  return "Not found";
}

/** The class as CSV. rows: [{ student, copy, file, result, mark, comment }].
 *  anonymous: "Student 3" instead of names (the same number for a student's second hand-in), and no file names. */
export function classCsv(rows, key, { anonymous = false } = {}) {
  const head = [anonymous ? "Student number" : "Student"].concat(anonymous ? [] : ["File"], ["Hand-ins from this student", "Locked", "Places found", "Route on the trail (%)", "Route reaches"]);
  for (const p of key.places) head.push(p.name + ": result", p.name + ": student's text");
  head.push("Notes and other points", "Empty pop-ups", "Missing layers", "Teacher's mark", "Teacher's comment");
  const lines = [head.map(cell).join(",")];
  const ids = new Map(), count = new Map();
  for (const r of rows) { const k = String(r.student).toLowerCase(); if (!ids.has(k)) ids.set(k, ids.size + 1); count.set(k, (count.get(k) || 0) + 1); }
  for (const r of rows) {
    const k = String(r.student).toLowerCase(), copy = r.copy > 1 ? ` (copy ${r.copy})` : "";
    const res = r.result;
    const row = [(anonymous ? "Student " + ids.get(k) : r.student) + copy].concat(anonymous ? [] : [r.file], [count.get(k)]);
    if (!res) { row.push("", "Couldn't read this file"); lines.push(row.map(cell).join(",")); continue; }
    row.push(res.locked ? "Yes" : "No", res.placesFound + " of " + res.places.length,
      res.route ? (res.route.drawn ? Math.round(res.route.shareOnRoute * 100) : "No line") : "", res.route && res.route.drawn ? res.route.reachesCheckpoint || "" : "");
    for (const p of res.places) row.push(placeStatus(p), p.found ? [p.title, p.text].filter(Boolean).join(": ") : "");
    row.push(res.notes.map((n) => [n.title, n.text].filter(Boolean).join(": ")).join(" | "), res.emptyPopups, res.missingLayers.join("; "), r.mark || "", r.comment || "");
    lines.push(row.map(cell).join(","));
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";   // the mark at the start tells Excel it's UTF-8 (accents, ī)
}
