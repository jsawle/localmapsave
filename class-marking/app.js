// Class map review (MapMaker Labs): check a class's .amap hand-ins against an answer map.
// Everything runs in the browser. Student files are only read: their own layers are listed, never loaded,
// and only their sketches are drawn, by this app, with its own symbols.
import { readHandIn, assess, CHECKS_VERSION } from "./tools/checks.mjs?v=0.2.1";
import { keyFromAnswerMap, studentFromFile, classCsv, placeStatus, KEYS_VERSION } from "./tools/keys.mjs?v=0.2.1";
import { readWebMap, WEBMAP_WRITER_VERSION } from "./lib/doc.js?v=0.2.1";
import { instructionsFor, AI_VERSION } from "./tools/ai.mjs?v=0.2.1";

const APP_VERSION = "0.2.1";
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };
const say = (msg) => { $("live").textContent = ""; setTimeout(() => { $("live").textContent = msg; }, 50); };

let answerRaw = null, answerName = "", skipPoints = new Set(), key = null, sampleKey = null;
let handIns = [], otherFiles = 0, current = -1, sampleRubric = "";

// ------------------------------------------------------------------ versions
$("versions").append(...[["Class map review", APP_VERSION], ["Checks (places, routes, notes)", CHECKS_VERSION], ["Answer map reader and export", KEYS_VERSION], ["Instructions for your own AI", AI_VERSION], ["MapMaker map files read", WEBMAP_WRITER_VERSION]]
  .map(([a, b]) => el("tr", {}, el("td", { textContent: a }), el("td", { textContent: b }))));
$("aboutBtn").onclick = () => $("aboutDlg").showModal();
$("aboutClose").onclick = () => $("aboutDlg").close();

// ------------------------------------------------------------------ reading files
const readText = (f) => (f.text ? f.text() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); }));
const isMapFile = (name) => /\.(amap|mmap)$/i.test(name);
const MAX_BYTES = 20 * 1024 * 1024;

async function loadHandIns(fileList) {
  const files = [...fileList];
  const maps = files.filter((f) => isMapFile(f.name));
  otherFiles = files.length - maps.length;
  handIns = [];
  for (const f of maps.sort((a, b) => a.name.localeCompare(b.name))) {
    let raw = null;
    try { if (f.size > MAX_BYTES) throw new Error("too big"); raw = JSON.parse(await readText(f)); if (!raw || typeof raw !== "object") throw new Error("not a map"); } catch (e) { raw = null; }
    // an answer map in the folder: use it if none is chosen, and don't list it as a student
    if (raw && /answer/i.test(f.name)) { if (!answerRaw) setAnswer(raw, f.name); else otherFiles++; continue; }
    handIns.push({ file: f.name, ...studentFromFile(f.name), raw });
  }
  $("classStatus").textContent = handIns.length ? `${handIns.length} hand-in${handIns.length === 1 ? "" : "s"} found` + (otherFiles ? `; ${otherFiles} other file${otherFiles === 1 ? "" : "s"} skipped.` : ".") : "No .amap files there. Choose the folder the class saved into.";
  sampleKey = null;
  ready();
}
document.querySelectorAll("[data-pick]").forEach((b) => { b.onclick = () => $(b.dataset.pick).click(); });
$("folderInput").onchange = (e) => loadHandIns(e.target.files);
$("filesInput").onchange = (e) => loadHandIns(e.target.files);
$("answerInput").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { setAnswer(JSON.parse(await readText(f)), f.name); sampleKey = null; } catch (err) { $("answerStatus").textContent = "Couldn't read that file. Choose a map saved from MapMaker."; answerRaw = null; ready(); }
};

const NOTE_LIKE = /pattern|why|note|question|reason|\?\s*$/i;
function setAnswer(raw, name) {
  answerRaw = raw; answerName = name;
  const h = readHandIn(raw);
  skipPoints = new Set(h.points.map((p, i) => (NOTE_LIKE.test(p.title) ? i : -1)).filter((i) => i >= 0));
  const list = $("answerPoints"); list.textContent = "";
  h.points.forEach((p, i) => {
    const id = "ap" + i, cb = el("input", { type: "checkbox", id, checked: !skipPoints.has(i) });
    cb.onchange = () => { if (cb.checked) skipPoints.delete(i); else skipPoints.add(i); ready(); };
    list.append(el("li", {}, cb, " ", el("label", { htmlFor: id, textContent: p.title || "Point " + (i + 1) })));
  });
  $("routeKmRow").hidden = !h.lines.length;
  $("answerSetup").hidden = false;
  $("answerStatus").textContent = `Using “${name}”: ${h.points.length} point${h.points.length === 1 ? "" : "s"}` + (h.lines.length ? " and a route." : ".") + (skipPoints.size ? " Points that look like notes are left out; tick them to count them." : "");
  ready();
}
["placeKm", "routeKm"].forEach((id) => { $(id).onchange = ready; });
function ready() { $("checkBtn").disabled = !(handIns.length && (answerRaw || sampleKey)); }

// ------------------------------------------------------------------ samples
const SAMPLES = { volcanoes: { dir: "assignments/volcanoes/", answer: "Volcanoes - answer key_locked.amap" },
  "oregon-trail": { dir: "assignments/oregon-trail/", answer: "Oregon Trail - answer key_locked.amap" } };
document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", async () => {
  const s = SAMPLES[b.dataset.sample];
  b.disabled = true; say("Loading the sample class…");
  try {
    const get = async (p, json = true) => { const r = await fetch(s.dir + p.split("/").map(encodeURIComponent).join("/")); if (!r.ok) throw new Error(p); return json ? r.json() : r.text(); };
    const k = await get("key.json"), exp = await get("expected.json");
    sampleRubric = await get("rubric.txt", false).catch(() => "");
    if (k.route && typeof k.route.paths === "string") k.route.paths = (await (await fetch("tools/trails-west.json")).json()).trails.Oregon;
    setAnswer(await get(s.answer), s.answer);
    const files = [];
    for (const r of exp.results) files.push(new File([await get("class/" + r.file, false)], r.file));
    await loadHandIns(files);
    // the answer map's own words for each place, shown in its pop-up on the map
    const own = keyFromAnswerMap(answerRaw, { skip: [...skipPoints] });
    for (const p of k.places) { const m = own.places.find((q) => Math.abs(q.lonlat[0] - p.lonlat[0]) < 0.01 && Math.abs(q.lonlat[1] - p.lonlat[1]) < 0.01); if (m) p.answer = m.answer; }
    sampleKey = k; ready();
    $("answerStatus").textContent = `Sample: “${k.title}”, with its own key (places, accepted answers and route).`;
    $("answerSetup").hidden = true;
    check();
  } catch (e) { console.error(e); say("Couldn't load the sample class."); }
  b.disabled = false;
}));

// ------------------------------------------------------------------ marks (this browser only)
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window: marks last until the page closes */ } } };
let marksKey = "", marks = {};
const markOf = (h) => marks[h.file] || { mark: "", comment: "" };
function setMark(h, field, value) { marks[h.file] = { ...markOf(h), [field]: value }; store.set(marksKey, marks); }

// ------------------------------------------------------------------ checking
$("checkBtn").onclick = check;
function check() {
  key = sampleKey || keyFromAnswerMap(answerRaw, { placeKm: Number($("placeKm").value) || 50, routeKm: Number($("routeKm").value) || 50, skip: [...skipPoints], title: answerName.replace(/\.(amap|mmap)$/i, "") });
  for (const h of handIns) h.result = h.raw ? assess(readHandIn(h.raw), key) : null;
  marksKey = "classMapReview:" + (key.title || answerName) + ":" + key.places.map((p) => p.name).join("|");
  marks = store.get(marksKey);
  $("setup").hidden = true; $("review").hidden = false;
  $("reviewH").textContent = key.title || "Class";
  const dup = new Set(handIns.filter((h) => handIns.filter((x) => x.student.toLowerCase() === h.student.toLowerCase()).length > 1).map((h) => h.student.toLowerCase()));
  for (const h of handIns) h.duplicate = dup.has(h.student.toLowerCase());
  $("reviewStatus").textContent = `${handIns.length} hand-ins · ${key.places.length} places to find` + (key.route ? " · a route" : "");
  $("skipped").textContent = otherFiles ? `${otherFiles} other file${otherFiles === 1 ? " was" : "s were"} skipped (not .amap).` : "";
  renderTable();
  $("reviewH").focus();
  say(`Checked ${handIns.length} hand-ins.`);
}

const pill = (text, cls) => el("span", { className: "pill " + cls, textContent: text });
function renderTable() {
  const body = $("classBody"); body.textContent = "";
  handIns.forEach((h, i) => {
    const r = h.result, m = markOf(h);
    const tr = el("tr");
    tr.append(el("th", { scope: "row", textContent: h.student + (h.copy > 1 ? ` (copy ${h.copy})` : "") }));
    if (!r) {
      tr.append(el("td", { colSpan: 3, className: "bad", textContent: "Couldn't read this file. It may be damaged or not a map." }), el("td", {}, pill("Unreadable", "bad")));
    } else {
      const total = r.places.length, inNote = r.places.filter((p) => !p.found && p.inNote).length, far = r.places.filter((p) => !p.found && p.namedButFarKm).length;
      const pc = el("td", { className: "num" }, `${r.placesFound} of ${total}`);
      if (inNote) pc.append(el("br"), pill(`${inNote} in a note`, "warn"));
      if (far) pc.append(el("br"), pill(`${far} too far away`, "warn"));
      tr.append(pc);
      const rt = el("td");
      if (!key.route) rt.append(el("span", { className: "muted", textContent: "—" }));
      else if (!r.route.drawn) rt.append(pill("No line", "bad"));
      else rt.append(`${Math.round(r.route.shareOnRoute * 100)}% on the route`, el("br"), el("span", { className: "muted", textContent: "reaches " + (r.route.reachesCheckpoint || "none of the stops") }));
      tr.append(rt);
      const nt = el("td");
      nt.append(`${r.notes.length} note${r.notes.length === 1 ? "" : "s"}`);
      if (r.emptyPopups) nt.append(el("br"), pill(`${r.emptyPopups} empty pop-up${r.emptyPopups === 1 ? "" : "s"}`, "warn"));
      if (r.missingLayers.length) nt.append(el("br"), pill(`Missing layer: ${r.missingLayers.join(", ")}`, "warn"));
      tr.append(nt);
      const hi = el("td");
      hi.append(r.locked ? pill("Locked", "ok") : pill("Not locked", "warn"));
      if (h.duplicate) hi.append(pill("More than one hand-in", "warn"));
      tr.append(hi);
    }
    tr.append(el("td", { textContent: m.mark || "" }));
    const b = el("button", { className: "btn", type: "button", textContent: "Review" });
    b.setAttribute("aria-label", "Review " + h.student + (h.copy > 1 ? ", copy " + h.copy : ""));
    b.onclick = () => openDetail(i);
    tr.append(el("td", {}, b));
    body.append(tr);
  });
  $("tableCaption").textContent = `${handIns.length} hand-ins. Select Review to see a student's map, what they wrote, and to add a mark.`;
}

// ------------------------------------------------------------------ one student's map
let sdk = null, view = null, answerLayer = null, answerMarks = null, studentLayer = null, baseWebMapFor = null;
async function loadSdk() {
  if (sdk) return sdk;
  const [WebMap, MapView, GraphicsLayer, Graphic] = await $arcgis.import(["@arcgis/core/WebMap.js", "@arcgis/core/views/MapView.js", "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/Graphic.js"]);
  sdk = { WebMap, MapView, GraphicsLayer, Graphic };
  return sdk;
}
const circle = ([lon, lat], rKm) => { const pts = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; pts.push([lon + (rKm * Math.sin(a)) / (111.32 * Math.cos(lat * Math.PI / 180)), lat + (rKm * Math.cos(a)) / 110.57]); } return pts; };
const textContent = (t) => () => el("div", { textContent: t || "" });
async function drawMap(h) {
  const { WebMap, MapView, GraphicsLayer, Graphic } = await loadSdk();
  if (!view || baseWebMapFor !== answerRaw) {
    // the basemap and layers come from the teacher's answer map, read the way Atlas reads an opened file
    const parsed = answerRaw ? readWebMap(answerRaw) : { ok: false };
    const wm = parsed.ok && parsed.webmap ? WebMap.fromJSON(parsed.webmap) : new WebMap({ basemap: "topo-vector" });
    // drawing order: the answer map's layers, the answer route and areas, the student's sketches, then rings
    // round the answer places on top, so a student's point shows inside its ring
    answerLayer = new GraphicsLayer({ title: "Answer map", listMode: "hide" });
    studentLayer = new GraphicsLayer({ title: "Student's sketches" });
    answerMarks = new GraphicsLayer({ title: "Answer places", listMode: "hide" });
    wm.addMany([answerLayer, studentLayer, answerMarks]);
    if (!view) view = new MapView({ container: "mapDiv", map: wm, popup: { dockEnabled: true, dockOptions: { position: "bottom-left", breakpoint: false } } });
    else view.map = wm;
    baseWebMapFor = answerRaw;
    // the answer: a ring at each place, its tolerance, and the route
    const purple = [106, 61, 154];
    for (const p of key.places) {
      answerLayer.add(new Graphic({ geometry: { type: "polygon", rings: [circle(p.lonlat, p.toleranceKm)], spatialReference: { wkid: 4326 } },
        symbol: { type: "simple-fill", color: [...purple, 0.06], outline: { type: "simple-line", style: "dash", color: [...purple, 0.9], width: 1.25 } } }));
      answerMarks.add(new Graphic({ geometry: { type: "point", longitude: p.lonlat[0], latitude: p.lonlat[1] },
        symbol: { type: "simple-marker", style: "circle", size: 24, color: [0, 0, 0, 0], outline: { color: [...purple, 1], width: 3 } },
        attributes: { name: p.name }, popupTemplate: { title: "Answer: {name}", content: textContent(p.answer || "") } }));
    }
    if (key.route) for (const path of key.route.paths) answerLayer.add(new Graphic({ geometry: { type: "polyline", paths: [path], spatialReference: { wkid: 4326 } },
      symbol: { type: "simple-line", style: "short-dash", color: [...purple, 0.85], width: 3 } }));
  }
  showAnswer();
  studentLayer.removeAll();
  const s = h.raw ? readHandIn(h.raw) : { points: [], lines: [], areas: [] };
  const rgb = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(hex || ""); const n = m ? parseInt(m[1], 16) : 0x0079c1; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const tmpl = (g) => ({ title: g.title ? "{title}" : "(no title)", content: textContent(g.description || "(nothing written)") });
  for (const a of s.areas) studentLayer.add(new Graphic({ geometry: { type: "polygon", rings: a.rings, spatialReference: { wkid: 4326 } }, attributes: { title: a.title }, popupTemplate: tmpl(a),
    symbol: { type: "simple-fill", color: [...rgb(a.color), 0.25], outline: { color: [...rgb(a.color), 1], width: 2 } } }));
  for (const l of s.lines) studentLayer.add(new Graphic({ geometry: { type: "polyline", paths: l.paths, spatialReference: { wkid: 4326 } }, attributes: { title: l.title }, popupTemplate: tmpl(l),
    symbol: { type: "simple-line", color: [...rgb(l.color), 1], width: 4 } }));
  for (const p of s.points) studentLayer.add(new Graphic({ geometry: { type: "point", longitude: p.lonlat[0], latitude: p.lonlat[1] }, attributes: { title: p.title }, popupTemplate: tmpl(p),
    symbol: { type: "simple-marker", style: "circle", size: 12, color: [...rgb(p.color), 1], outline: { color: [255, 255, 255, 1], width: 1.5 } } }));
  try {
    await view.when();
    const all = studentLayer.graphics.toArray().concat(answerMarks.visible ? answerMarks.graphics.toArray() : []);
    if (all.length) await view.goTo(all, { animate: false }).catch(() => {});
    view.closePopup && view.closePopup();
  } catch (e) { /* the map can't draw (no WebGL, offline): the list beside it has everything */ }
}
// "Show the answer map": the answer overlay and the answer map's own layers (the student's sketches stay)
function showAnswer() {
  if (!view || !view.map) return;
  const on = $("showAnswer").checked;
  view.map.layers.forEach((l) => { if (l !== studentLayer) l.visible = on; });
}
$("showAnswer").onchange = showAnswer;

function factWords(v) { return v === true ? ["matches the key", "ok"] : v === false ? ["doesn't match the key", "bad"] : ["for you to check", "muted"]; }
function renderSide(h) {
  const side = $("side"); side.textContent = "";
  const r = h.result;
  if (!r) { side.append(el("p", { className: "bad", textContent: "This file couldn't be read. It may be damaged, or not a map saved from MapMaker. Ask the student to save and hand in again." })); }
  else {
    side.append(el("h3", { textContent: `Places: ${r.placesFound} of ${r.places.length} marked` }));
    const keyPlaces = new Map(key.places.map((p) => [p.name, p]));
    for (const p of r.places) {
      const cls = p.found ? "found" : (p.inNote || p.namedButFarKm) ? "part" : "missing";
      const box = el("div", { className: "place " + cls }, el("b", { textContent: p.name }), el("span", { textContent: placeStatus(p) }));
      if (p.found) {
        box.append(el("div", { className: "quote", textContent: [p.title || "(no title)", p.text || "(nothing written)"].join("\n") }));
        if (!p.named) box.append(el("div", { className: "warn", textContent: "The title doesn't name this place." }));
        const facts = (keyPlaces.get(p.name) || {}).facts || [];
        for (const f of facts) { const [w, c] = factWords(p.facts[f.id]); box.append(el("div", { className: c, textContent: `${f.label}: ${w}` })); }
      }
      side.append(box);
    }
    if (key.route) {
      side.append(el("h3", { textContent: "Route" }));
      side.append(el("p", { textContent: !r.route.drawn ? "No line drawn." : `${Math.round(r.route.shareOnRoute * 100)}% of the line is within ${key.route.toleranceKm} km of the route. It reaches ${r.route.reachesCheckpoint || "none of the stops"}. Length ${r.route.lengthKm.toLocaleString()} km.` }));
    }
    side.append(el("h3", { textContent: r.notes.length ? "Notes and other points" : "Notes" }));
    if (!r.notes.length) side.append(el("p", { className: "muted", textContent: "None." }));
    for (const n of r.notes) side.append(el("div", { className: "quote", textContent: [n.title || "(no title)", n.text].filter(Boolean).join("\n") }));
    const extra = [];
    if (r.emptyPopups) extra.push(`${r.emptyPopups} point${r.emptyPopups === 1 ? " has" : "s have"} an empty pop-up.`);
    if (r.missingLayers.length) extra.push("Layers in your answer map but not in this one: " + r.missingLayers.join(", ") + ".");
    extra.push(r.locked ? "Handed in locked." : "Not locked: it could have been changed after it was handed in.");
    if (h.duplicate) extra.push("This student has more than one hand-in in the folder.");
    side.append(el("h3", { textContent: "Hand-in" }), ...extra.map((t) => el("p", { textContent: t })));
  }
  const m = markOf(h);
  const markIn = el("input", { type: "text", id: "markIn", value: m.mark });
  const comIn = el("textarea", { id: "commentIn", value: m.comment });
  markIn.oninput = () => { setMark(h, "mark", markIn.value); };
  markIn.onchange = renderTable;
  comIn.oninput = () => setMark(h, "comment", comIn.value);
  side.append(el("h3", { textContent: "Your mark" }), el("div", { className: "mark" },
    el("p", {}, el("label", { htmlFor: "markIn", textContent: "Mark " }), markIn),
    el("p", {}, el("label", { htmlFor: "commentIn", textContent: "Comment" }), el("br"), comIn),
    el("p", { className: "legend", textContent: "Kept in this browser on this device, and included in the export." })));
  side.append(el("p", { className: "legend" }, el("span", { className: "swatch", style: "border:3px solid #6a3d9a" }), "Purple rings, dashed circles and dashed lines are your answer map, with its layers. The student's own sketches are in their colours. Turn off Show the answer map to see the student's map alone."));
}

function openDetail(i) {
  current = i;
  const h = handIns[i];
  $("detail").hidden = false;
  $("detailH").textContent = h.student + (h.copy > 1 ? ` (copy ${h.copy})` : "") + ` — ${i + 1} of ${handIns.length}`;
  $("prevBtn").disabled = i === 0; $("nextBtn").disabled = i === handIns.length - 1;
  renderSide(h);
  $("detail").focus();
  $("detail").scrollIntoView({ block: "start" });
  drawMap(h).catch((e) => console.error(e));
}
$("prevBtn").onclick = () => { if (current > 0) openDetail(current - 1); };
$("nextBtn").onclick = () => { if (current < handIns.length - 1) openDetail(current + 1); };
$("closeDetail").onclick = () => { $("detail").hidden = true; renderTable(); const b = $("classBody").querySelectorAll("button")[current]; if (b) b.focus(); };
$("detail").addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.target.closest(".esri-popup")) $("closeDetail").click(); });

// ------------------------------------------------------------------ export and start again
$("exportBtn").onclick = () => exportCsv($("anonymous").checked);
function exportCsv(anonymous) {
  const rows = handIns.map((h) => ({ student: h.student, copy: h.copy, file: h.file, result: h.result, ...markOf(h) }));
  const csv = classCsv(rows, key, { anonymous });
  const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: (key.title || "class").replace(/[^\w\- ]+/g, "").trim() + (anonymous ? " - numbered" : "") + ".csv" });
  document.body.append(a); a.click(); a.remove();
  say(anonymous ? "Exported with numbers instead of names. Students' own words may still include names." : "Exported.");
}

// ------------------------------------------------------------------ the teacher's own AI
const rubricKey = () => "classMapReview:rubric:" + marksKey;
function aiText() {
  const own = answerRaw ? keyFromAnswerMap(answerRaw, { skip: [...skipPoints] }) : { places: [], answerNotes: [] };
  const answers = key.places.map((p) => { const m = own.places.find((q) => Math.abs(q.lonlat[0] - p.lonlat[0]) < 0.01 && Math.abs(q.lonlat[1] - p.lonlat[1]) < 0.01); return { name: p.name, text: p.answer || (m && m.answer) || "" }; });
  return instructionsFor({ title: key.title, key, rubric: $("aiRubric").value, answers, answerNotes: own.answerNotes });
}
$("aiBtn").onclick = () => {
  let saved = ""; try { saved = localStorage.getItem(rubricKey()) || ""; } catch (e) { /* private window */ }
  $("aiRubric").value = saved || sampleRubric || "";
  $("aiText").value = aiText(); $("aiCopied").textContent = "";
  $("aiDlg").showModal();
};
$("aiRubric").oninput = () => { $("aiText").value = aiText(); try { localStorage.setItem(rubricKey(), $("aiRubric").value); } catch (e) { /* private window */ } };
$("aiExport").onclick = () => exportCsv($("aiAnonymous").checked);
$("aiCopy").onclick = async () => {
  const text = aiText(); $("aiText").value = text;
  try { await navigator.clipboard.writeText(text); $("aiCopied").textContent = "Copied."; }
  catch (e) { const d = $("aiText"); d.closest("details").open = true; d.focus(); d.select(); $("aiCopied").textContent = "Select the text below and copy it (Ctrl+C)."; }
};
$("aiClose").onclick = () => $("aiDlg").close();
$("restartBtn").onclick = () => {
  handIns = []; answerRaw = null; sampleKey = null; key = null; baseWebMapFor = null; sampleRubric = "";
  ["folderInput", "filesInput", "answerInput"].forEach((id) => { $(id).value = ""; });
  $("classStatus").textContent = "No hand-ins chosen yet."; $("answerStatus").textContent = "No answer map chosen yet."; $("answerSetup").hidden = true;
  $("detail").hidden = true; $("review").hidden = true; $("setup").hidden = false; ready(); $("main").focus();
};
