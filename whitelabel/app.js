// Map Studio: a configurable (white-label) school mapping app on ArcGIS Maps SDK for JavaScript 5.1.
// One Map is shared by a 2D MapView and a 3D SceneView. Everything a distributor changes lives in config/<name>.json.
import { readCsv, buildCsvLayerDef, rendererFor, CSV_VERSION } from "./modules/csv.js";

const APP_VERSION = "0.2";
const DOC_TYPE = "MapMakerLocalDocument", DOC_VERSION = 4;   // same file type as the Atlas local-save concept, so its .mmap files open here

const STRINGS = {
  addLayers: "Add layers", layers: "Layers", legend: "Legend", basemaps: "Basemaps", measure: "Measure", sketch: "Sketch",
  animations: "3D animations", about: "About", open: "Open", save: "Save", newMap: "New", untitled: "Untitled map",
  unsaved: "Unsaved changes", dropHint: "Drop a CSV file with latitude and longitude columns onto the map, or a saved map (.mmap).",
  searchLayers: "Search layers", allTopics: "All topics", add: "Add", added: "Added", more: "More", noResults: "No layers match. Try another word or topic.",
  distance: "Distance", area: "Area", clear: "Clear", view2d: "2D", view3d: "3D", yourData: "Your own data", chooseCsv: "Choose a CSV file",
  sketchHint: "Draw points, lines and areas. They are saved with your map.", animHint: "3D animations of physical processes. They open in the 3D view.",
  sketchLayer: "My drawings", styleBy: "Colour by", noStyle: "One colour", remove: "Remove",
  discard: "You have unsaved changes. Discard them?", saved: "Saved {name}.", savedDownload: "Saved {name} to your downloads.",
  opened: "Opened {title}.", notMapFile: "That isn't a saved map (.mmap) from here.", cantRead: "Couldn't read that file.",
  addedLayer: "Added {title}.", layerFailed: "Couldn't add {title}. It may not be public.", csvMapped: "Mapped {n} places from {file}.",
  csvSkipped: "{n} rows had no usable latitude and longitude and were left out.",
  csvEmpty: "That file is empty.", csvA1: "Your data needs to start in the top-left cell (A1). Remove any blank rows above your headings.",
  csvA1col: "Your data needs to start in the top-left cell (A1). The first column has no heading.",
  csvNoHeading: "Column {n} has no heading. Every column needs a name in row 1.", csvNoRows: "There's no data under the headings. Add at least one row.",
  csvTooMany: "That's {n} rows. This app can map up to {max}. Try a smaller file.",
  csvNoLatLon: "Couldn't find latitude and longitude columns. Name them Latitude and Longitude (Lat and Lon also work).",
  csvNoCoords: "None of the rows had usable latitude and longitude. Use decimal degrees, for example 51.5 and -0.12.",
  needs3d: "This animation needs the 3D view.", no3d: "The 3D view couldn\u2019t start on this device.", cantSwitch: "Couldn\u2019t switch the view.", closeAnim: "Close animation", start: "Open", loadingAnim: "Loading the animation…"
};

const $ = (id) => document.getElementById(id);
const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");

// ---------- Config ----------
const params = new URLSearchParams(location.search);
const cfgName = (params.get("config") || "default").replace(/[^\w-]/g, "");
async function loadJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }
let cfg;
try { cfg = await loadJSON(`./config/${cfgName}.json`); } catch (e) { console.warn("Config not found, using default", e); cfg = await loadJSON("./config/default.json"); }
const S = { ...STRINGS, ...(cfg.strings || {}) };
const PORTAL = (cfg.portalUrl || "https://www.arcgis.com").replace(/\/$/, "");

function applyBranding() {
  const t = cfg.theme || {}, r = document.documentElement.style;
  for (const [k, v] of Object.entries({ brand: t.brand, "brand-ink": t.brandInk, header: t.header, "header-ink": t.headerInk, accent: t.accent })) if (v) r.setProperty("--" + k, v);
  document.documentElement.lang = cfg.locale || "en"; document.documentElement.dir = cfg.dir || "ltr";
  document.title = cfg.appName; $("appName").textContent = cfg.appName;
  if (cfg.logo && cfg.logo.url) { $("logo").src = cfg.logo.url; $("logo").alt = cfg.logo.alt || cfg.appName; $("logoLink").hidden = false; if (cfg.logo.link) $("logoLink").href = cfg.logo.link; }
  document.querySelectorAll("[data-i18n]").forEach((el) => { if (S[el.dataset.i18n]) el.textContent = S[el.dataset.i18n]; });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { if (S[el.dataset.i18nPlaceholder]) el.placeholder = S[el.dataset.i18nPlaceholder]; });
  $("aboutTagline").textContent = cfg.tagline || ""; $("disclaimer").textContent = cfg.disclaimer || "";
}
applyBranding();

// ---------- ArcGIS ----------
const [EsriMap, Basemap, Layer, WebMap, GroupLayer, GraphicsLayer, FeatureLayer, Graphic, PortalBasemapsSource, esriConfig, reactiveUtils] = await $arcgis.import([
  "@arcgis/core/Map.js", "@arcgis/core/Basemap.js", "@arcgis/core/layers/Layer.js", "@arcgis/core/WebMap.js", "@arcgis/core/layers/GroupLayer.js",
  "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/layers/FeatureLayer.js", "@arcgis/core/Graphic.js",
  "@arcgis/core/widgets/BasemapGallery/support/PortalBasemapsSource.js", "@arcgis/core/config.js", "@arcgis/core/core/reactiveUtils.js"
]);
esriConfig.portalUrl = PORTAL;

const map = new EsriMap({ basemap: new Basemap({ portalItem: { id: cfg.defaultBasemap } }), ground: "world-elevation" });
const sketchLayer = new GraphicsLayer({ title: S.sketchLayer, elevationInfo: { mode: "on-the-ground" } });
map.add(sketchLayer);
const mapEl = $("mapEl"), sceneEl = $("sceneEl");
mapEl.map = map;
await mapEl.viewOnReady();
await mapEl.view.goTo({ center: cfg.startView.center, zoom: cfg.startView.zoom }, { animate: false }).catch(() => {});

let mode = "2d";
const activeEl = () => (mode === "3d" ? sceneEl : mapEl);
const activeView = () => activeEl().view;

// ---------- Toast + dirty state ----------
let toastTimer = 0;
function toast(msg, ms = 3500) { const el = $("toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms); }
let dirty = false;
function setDirty(v) { dirty = v; $("dirty").textContent = v ? S.unsaved : ""; }
const confirmDiscard = () => !dirty || confirm(S.discard);
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- Tool rail and panel ----------
const ICON = {
  addLayers: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="M19 17v6M16 20h6"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  legend: '<rect x="4" y="5" width="4" height="4"/><rect x="4" y="15" width="4" height="4"/><path d="M11 7h9M11 17h9"/>',
  basemaps: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  measure: '<path d="M3 17 17 3l4 4L7 21l-4-4Z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
  sketch: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
  animations: '<path d="M3 20h18"/><path d="M6 20 11 9l3 5 2-3 3 9"/><path d="M11 9c0-3 2-5 4-6"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'
};
const TOOLS = [
  ["addLayers", cfg.features.addLayers !== false], ["layers", true], ["legend", true], ["basemaps", true],
  ["measure", cfg.features.measure !== false], ["sketch", cfg.features.sketch !== false],
  ["animations", cfg.features.animations !== false && cfg.features.threeD !== false && (cfg.animations || []).length > 0], ["about", true]
].filter(([, on]) => on).map(([k]) => k);
$("rail").innerHTML = TOOLS.map((k) => `<button class="rbtn" data-tool="${k}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${S[k]}</button>`).join("");
let openTool = null;
function showTool(k) {
  openTool = openTool === k ? null : k;
  document.querySelectorAll(".rbtn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === openTool)));
  $("panel").hidden = !openTool;
  document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== openTool));
  if (openTool) { $("panelTitle").textContent = S[openTool]; onToolOpen(openTool); }
}
$("rail").addEventListener("click", (e) => { const b = e.target.closest(".rbtn"); if (b) showTool(b.dataset.tool); });
$("panelClose").onclick = () => showTool(openTool);
document.querySelectorAll(".pane").forEach((p) => (p.hidden = true));
function onToolOpen(k) {
  if (k === "addLayers" && !lb.loaded) lbInit();
  if (k === "animations") listAnimations();
  if (k === "about") renderVersions();
}

// Panel components follow whichever view is showing.
const panelComponents = () => ["layerList", "legend", "basemapGallery", "measurement", "sketch"].map($);
function bindPanels() { for (const el of panelComponents()) el.referenceElement = activeEl(); }
$("basemapGallery").source = new PortalBasemapsSource({ query: { id: cfg.basemapGroup } });
$("sketch").layer = sketchLayer;
$("measurement").linearUnit = cfg.units === "imperial" ? "imperial" : "metric";
$("measurement").areaUnit = cfg.units === "imperial" ? "imperial" : "metric";
bindPanels();

// ---------- 2D / 3D ----------
if (cfg.features.threeD === false) $("modeSwitch").hidden = true;
async function setMode(m) {
  if (m === mode) return;
  const vp = activeView().viewpoint.clone();
  if (m === "2d") stopAnimation();
  try { await $("measurement").clear?.(); } catch (e) {}
  try {
    if (m === "3d") {
      // The scene component makes its own empty map on load, so always hand it ours.
      if (sceneEl.map !== map) sceneEl.map = map;
      sceneEl.hidden = false; await sceneEl.viewOnReady(); sceneEl.view.viewpoint = vp; mapEl.hidden = true;
    } else {
      mapEl.hidden = false; await mapEl.viewOnReady(); mapEl.view.viewpoint = vp; sceneEl.hidden = true;
    }
  } catch (e) {
    console.error("Couldn't switch view", e);
    mapEl.hidden = false; sceneEl.hidden = true; mode = "2d";
    toast(m === "3d" ? S.no3d : S.cantSwitch, 6000); return;
  }
  mode = m;
  $("to2d").setAttribute("aria-pressed", String(m === "2d")); $("to3d").setAttribute("aria-pressed", String(m === "3d"));
  bindPanels();
}
$("to2d").onclick = () => setMode("2d");
$("to3d").onclick = () => setMode("3d");

// ---------- Measure ----------
$("mDistance").onclick = () => { $("measurement").activeTool = mode === "3d" ? "direct-line" : "distance"; };
$("mArea").onclick = () => { $("measurement").activeTool = "area"; };
$("mClear").onclick = () => { $("measurement").clear?.(); };

// ---------- Layer browser (the Schools Living Atlas group, by topic) ----------
const TYPES = ["Feature Service", "Map Service", "Image Service", "Vector Tile Service", "Scene Service", "Web Map"];
const lb = { loaded: false, start: 1, next: -1, token: 0 };
const addedItems = new Map();          // itemId -> layer
async function lbInit() {
  lb.loaded = true;
  const opts = [`<option value="">${S.allTopics}</option>`];
  try {
    const schema = await loadJSON(`${PORTAL}/sharing/rest/community/groups/${cfg.contentGroup}/categorySchema?f=json`);
    const walk = (nodes, path, depth) => { for (const n of nodes || []) { const p = `${path}/${n.title}`;
      opts.push(`<option value="${p.replace(/"/g, "&quot;")}">${"\u2003".repeat(depth)}${n.title}</option>`); walk(n.categories, p, depth + 1); } };
    for (const root of schema.categorySchema || []) walk(root.categories, "/" + root.title, 0);
  } catch (e) { console.warn("No topics", e); }
  $("lbTopic").innerHTML = opts.join("");
  lbSearch(true);
}
let lbTimer = 0;
$("lbSearch").oninput = () => { clearTimeout(lbTimer); lbTimer = setTimeout(() => lbSearch(true), 300); };
$("lbTopic").onchange = () => lbSearch(true);
$("lbMore").onclick = () => lbSearch(false);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function lbSearch(reset) {
  const token = ++lb.token;
  if (reset) { lb.start = 1; $("lbResults").innerHTML = ""; }
  const text = $("lbSearch").value.trim().replace(/["\\]/g, "");
  const q = `${text ? `(${text}) AND ` : ""}(${TYPES.map((t) => `type:"${t}"`).join(" OR ")})`;
  const u = new URL(`${PORTAL}/sharing/rest/content/groups/${cfg.contentGroup}/search`);
  u.search = new URLSearchParams({ f: "json", q, num: 20, start: lb.start, ...(text ? {} : { sortField: "title", sortOrder: "asc" }), ...($("lbTopic").value ? { categories: $("lbTopic").value } : {}) });
  let res; try { res = await loadJSON(u); } catch (e) { toast(S.cantRead); return; }
  if (token !== lb.token) return;
  const html = (res.results || []).map((it) => {
    const thumb = it.thumbnail ? `${PORTAL}/sharing/rest/content/items/${it.id}/info/${it.thumbnail}?w=200` : "";
    const on = addedItems.has(it.id);
    return `<div class="lb-item"><img src="${thumb}" alt="" loading="lazy" /><div><div class="t">${esc(it.title)}</div><div class="k">${esc(it.type)}</div></div>
      <div class="a"><button class="btn ${on ? "" : "primary"}" data-add="${it.id}" data-title="${esc(it.title)}" data-type="${esc(it.type)}">${on ? S.added : S.add}</button></div></div>`;
  }).join("");
  $("lbResults").insertAdjacentHTML("beforeend", html || (reset ? `<p class="hint">${S.noResults}</p>` : ""));
  lb.start = res.nextStart; $("lbMore").hidden = !(res.nextStart > 0); $("lbMore").textContent = S.more;
}
$("lbResults").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const id = b.dataset.add;
  if (addedItems.has(id)) { removeItem(id); b.textContent = S.add; b.classList.add("primary"); return; }
  b.disabled = true;
  const ok = await addItem(id, b.dataset.type, b.dataset.title);
  b.disabled = false; if (ok) { b.textContent = S.added; b.classList.remove("primary"); }
});
async function addItem(id, type, title, state) {
  try {
    let layer;
    if (type === "Web Map") {
      const wm = new WebMap({ portalItem: { id } }); await wm.load();
      const layers = wm.layers.toArray(); wm.layers.removeAll();
      layer = new GroupLayer({ title: title || wm.portalItem.title, layers });
    } else {
      layer = await Layer.fromPortalItem({ portalItem: { id } });
    }
    layer.__item = { itemId: id, type, title: title || layer.title };
    if (state) { if (state.visible != null) layer.visible = state.visible; if (state.opacity != null) layer.opacity = state.opacity; }
    map.add(layer); keepSketchOnTop(); addedItems.set(id, layer); setDirty(true);
    if (!state) toast(fmt(S.addedLayer, { title: layer.title }));
    return true;
  } catch (e) { console.error(e); toast(fmt(S.layerFailed, { title: title || id })); return false; }
}
function removeItem(id) { const l = addedItems.get(id); if (l) { map.remove(l); addedItems.delete(id); setDirty(true); } }
function keepSketchOnTop() { map.reorder(sketchLayer, map.layers.length - 1); }
map.layers.on("change", (e) => { for (const l of e.removed) { if (l.__item) addedItems.delete(l.__item.itemId); dataLayers.delete(l); } });

// ---------- Your own data: CSV ----------
const dataLayers = new Set();          // FeatureLayers built from CSV (or opened from a saved map)
function buildDataLayer(def) {
  const fields = def.fields.map((f) => ({ ...f }));
  const layer = new FeatureLayer({
    title: def.title, source: def.features.map((f) => new Graphic({ geometry: { type: def.geometryType || "point", ...f.geometry }, attributes: { ...f.attributes } })),
    objectIdField: def.objectIdField || "ObjectId", fields, geometryType: def.geometryType || "point", spatialReference: def.spatialReference || { wkid: 102100 },
    renderer: def.renderer, popupTemplate: def.popupInfo, elevationInfo: { mode: "relative-to-ground" }
  });
  layer.__def = def; dataLayers.add(layer); return layer;
}
function handleCsv(name, text) {
  const p = readCsv(text, S); if (!p.ok) { csvMessage(p.error, true); return; }
  const b = buildCsvLayerDef(name, p, S); if (!b.ok) { csvMessage(b.error, true); return; }
  const layer = buildDataLayer(b.def); map.add(layer); keepSketchOnTop(); setDirty(true);
  layer.when(() => layer.queryExtent()).then((r) => r.extent && activeView().goTo(r.extent.expand(1.3))).catch(() => {});
  toast(fmt(S.csvMapped, { n: b.def.features.length, file: name }));
  const opts = [`<option value="">${S.noStyle}</option>`, ...[...b.categorical, ...b.numeric].map((f) => `<option value="${f}">${esc(b.def.fields.find((x) => x.name === f).alias)}</option>`)];
  $("csvBox").innerHTML = `<div class="csv-box"><b>${esc(b.def.title)}</b>
    <p class="hint">${fmt(S.csvMapped, { n: b.def.features.length, file: esc(name) })}${b.dropped ? " " + fmt(S.csvSkipped, { n: b.dropped }) : ""}</p>
    <label class="hint" for="csvStyle">${S.styleBy}</label><select id="csvStyle" class="field">${opts.join("")}</select></div>`;
  $("csvStyle").onchange = () => { b.def.renderer = rendererFor(b.def, $("csvStyle").value, b.numeric); layer.renderer = b.def.renderer; setDirty(true); };
}
function csvMessage(msg, isError) { $("csvBox").innerHTML = `<div class="csv-box"${isError ? ' style="border-color:#c0392b"' : ""}><p class="hint" style="color:${isError ? "#c0392b" : "inherit"}">${esc(msg)}</p></div>`; if (isError) { if (openTool !== "addLayers") showTool("addLayers"); } toast(msg, 5000); }
$("csvPick").onclick = () => { $("fileInput").dataset.want = "csv"; $("fileInput").click(); };

// ---------- Save and open (a local .mmap file, no account) ----------
function basemapRef() { const b = map.basemap; return b?.portalItem?.id ? { itemId: b.portalItem.id } : (b?.id || "topo-vector"); }
function buildDocument() {
  const v = activeView();
  return {
    type: DOC_TYPE, version: DOC_VERSION, app: "Map Studio", appVersion: APP_VERSION, title: $("docTitle").value.trim() || S.untitled, savedAt: new Date().toISOString(),
    basemap: basemapRef(), mode,
    viewpoint: { center: [v.center.longitude, v.center.latitude], zoom: v.zoom },
    camera: mode === "3d" ? v.camera.toJSON() : null,
    portalLayers: [...addedItems.values()].map((l) => ({ ...l.__item, visible: l.visible, opacity: l.opacity })),
    graphics: sketchLayer.graphics.toArray().map((g) => ({ geometry: g.geometry.toJSON(), symbol: g.symbol ? g.symbol.toJSON() : null, attributes: g.attributes || {} })),
    layers: [...dataLayers].map((l) => ({ ...l.__def, title: l.title, visible: l.visible, opacity: l.opacity }))
  };
}
const slug = () => ($("docTitle").value.trim() || S.untitled).replace(/[^\w\-]+/g, "_").slice(0, 60) || "map";
let fileHandle = null;
function downloadText(text, name) { const u = URL.createObjectURL(new Blob([text], { type: "application/json" })); const a = document.createElement("a"); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(u); }
async function saveMap() {
  const text = JSON.stringify(buildDocument());
  if (window.showSaveFilePicker) {
    try {
      if (!fileHandle) fileHandle = await window.showSaveFilePicker({ suggestedName: slug() + ".mmap", types: [{ description: "Map", accept: { "application/json": [".mmap"] } }] });
      const w = await fileHandle.createWritable(); await w.write(text); await w.close();
      setDirty(false); toast(fmt(S.saved, { name: fileHandle.name })); return;
    } catch (e) { if (e && e.name === "AbortError") return; fileHandle = null; }
  }
  downloadText(text, slug() + ".mmap"); setDirty(false); toast(fmt(S.savedDownload, { name: slug() + ".mmap" }));
}
$("saveBtn").onclick = saveMap;
$("openBtn").onclick = () => { if (!confirmDiscard()) return; $("fileInput").dataset.want = "any"; $("fileInput").click(); };
$("fileInput").onchange = async () => { const f = $("fileInput").files[0]; $("fileInput").value = ""; if (f) handleFile(f); };
$("newBtn").onclick = () => { if (!confirmDiscard()) return; clearMap(); $("docTitle").value = ""; fileHandle = null; setDirty(false);
  activeView().goTo({ center: cfg.startView.center, zoom: cfg.startView.zoom }).catch(() => {}); };
$("docTitle").oninput = () => setDirty(true);

function clearMap() {
  stopAnimation();
  for (const l of [...addedItems.values(), ...dataLayers]) map.remove(l);
  addedItems.clear(); dataLayers.clear(); sketchLayer.removeAll(); $("csvBox").innerHTML = "";
  map.basemap = new Basemap({ portalItem: { id: cfg.defaultBasemap } });
}
const DEFAULT_SYMBOL = {
  point: { type: "simple-marker", color: [226, 119, 40], size: 10, outline: { color: "white", width: 1 } },
  polyline: { type: "simple-line", color: [226, 119, 40], width: 3 },
  polygon: { type: "simple-fill", color: [226, 119, 40, 0.35], outline: { color: [226, 119, 40], width: 2 } }
};
async function openDocument(doc) {
  clearMap(); fileHandle = null;
  if (doc.basemap) map.basemap = typeof doc.basemap === "string" ? doc.basemap : new Basemap({ portalItem: { id: doc.basemap.itemId } });
  for (const gj of doc.graphics || doc.sketch || []) {
    try {
      const g = Graphic.fromJSON({ geometry: gj.geometry, symbol: gj.symbol || undefined, attributes: gj.attributes || {} });
      if (!g.symbol && g.geometry) g.symbol = DEFAULT_SYMBOL[g.geometry.type] || DEFAULT_SYMBOL.point;
      sketchLayer.add(g);
    } catch (e) { console.warn("Skipped a drawing", e); }
  }
  for (const def of doc.layers || []) { try { const l = buildDataLayer(def); if (def.visible != null) l.visible = def.visible; if (def.opacity != null) l.opacity = def.opacity; map.add(l); } catch (e) { console.warn("Skipped a data layer", e); } }
  for (const it of doc.portalLayers || []) await addItem(it.itemId, it.type, it.title, it);
  keepSketchOnTop();
  $("docTitle").value = doc.title || "";
  if (doc.mode === "3d" && cfg.features.threeD !== false) { await setMode("3d"); if (doc.camera) await sceneEl.view.goTo(doc.camera, { animate: false }).catch(() => {}); }
  else { await setMode("2d"); if (doc.viewpoint) await mapEl.view.goTo({ center: doc.viewpoint.center, zoom: doc.viewpoint.zoom }, { animate: false }).catch(() => {}); }
  setDirty(false); toast(fmt(S.opened, { title: doc.title || S.untitled }));
}
async function handleFile(f) {
  const text = await f.text();
  if (/\.csv$/i.test(f.name) || f.type === "text/csv") { if (cfg.features.csv !== false) handleCsv(f.name, text); return; }
  let doc; try { doc = JSON.parse(text); } catch (e) { toast(S.cantRead); return; }
  if (!doc || doc.type !== DOC_TYPE) { toast(S.notMapFile); return; }
  if (dirty && !confirm(S.discard)) return;
  openDocument(doc);
}
// Drag and drop onto the map
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
$("main").addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $("drop").hidden = false; });
$("main").addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
$("main").addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop").hidden = true; } });
$("main").addEventListener("drop", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $("drop").hidden = true; for (const f of e.dataTransfer.files) handleFile(f); });

// Changes that make the map "unsaved"
sketchLayer.graphics.on("change", () => setDirty(true));
reactiveUtils.watch(() => map.basemap, () => setDirty(true));

// ---------- 3D animations (plug-ins) ----------
// Each animation is a module in animations/<id>/animation.js exporting `meta` and `start(ctx)`.
// start() gets the 3D view and a panel to build its controls in, and returns { dispose() }.
const anim = { mods: new Map(), current: null };
async function loadAnimMeta() {
  for (const id of cfg.animations || []) {
    if (anim.mods.has(id)) continue;
    try { anim.mods.set(id, await import(`./animations/${id}/animation.js`)); } catch (e) { console.error("Animation failed to load", id, e); }
  }
}
async function listAnimations() {
  await loadAnimMeta();
  $("animList").innerHTML = [...anim.mods.entries()].map(([id, m]) => `<div class="anim-card"><div class="t">${esc(m.meta.title)} <span class="ver">v${esc(m.meta.version)}</span></div>
    <p class="hint">${esc(m.meta.summary)}</p><button class="btn primary" data-anim="${id}">${S.start}</button></div>`).join("");
}
$("animList").addEventListener("click", (e) => { const b = e.target.closest("[data-anim]"); if (b) startAnimation(b.dataset.anim); });
async function startAnimation(id) {
  const mod = anim.mods.get(id); if (!mod) return;
  stopAnimation();
  if (mode !== "3d") { toast(S.needs3d, 2000); await setMode("3d"); }
  $("animList").hidden = true;
  const host = $("animHost");
  host.innerHTML = `<button class="btn" id="animClose">← ${S.closeAnim}</button><div id="animBody" style="margin-top:10px"><p class="hint">${S.loadingAnim}</p></div>`;
  $("animClose").onclick = stopAnimation;
  try {
    anim.current = await mod.start({ view: sceneEl.view, map, container: $("animBody"), toast, locale: cfg.locale, strings: cfg.animationStrings?.[id] || {} });
  } catch (e) { console.error(e); $("animBody").innerHTML = `<p class="hint">${esc(e.message || e)}</p>`; }
}
function stopAnimation() {
  if (anim.current) { try { anim.current.dispose(); } catch (e) { console.warn(e); } anim.current = null; }
  $("animHost").innerHTML = ""; $("animList").hidden = false;
}

// ---------- About: versions ----------
async function renderVersions() {
  await loadAnimMeta().catch(() => {});
  const rows = [["App", APP_VERSION, "Map Studio shell: 2D/3D, layers, tools, save/open. 0.2: fixed the 3D switch"], ["CSV import", CSV_VERSION, "Latitude/longitude CSV to a map layer"],
    ["Saved map format", String(DOC_VERSION), "MapMakerLocalDocument (.mmap). Opens files from the Atlas local-save concept"],
    ["Config", `${cfgName} v${cfg.configVersion || 1}`, "Branding and content for this programme"]];
  for (const [, m] of anim.mods) for (const [name, v, what] of m.meta.models || [[m.meta.title, m.meta.version, m.meta.summary]]) rows.push([name, v, what]);
  $("versTable").innerHTML = `<tr><th>Part</th><th>Version</th><th>What it is</th></tr>` + rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join("");
}
console.info("Map Studio", APP_VERSION, "config", cfgName);
