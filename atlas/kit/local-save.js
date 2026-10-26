// Save a map to a file on the device and open it again, with no account. The file is an ArcGIS web map (Web Map
// Specification JSON): the same JSON a web map item stores in ArcGIS Online. Sketches and spreadsheet layers are written
// as feature collections and come back editable. Works with ArcGIS Maps SDK for JavaScript 4.x and 5.x; SDK classes are
// passed in. Part of the Atlas local save and add data kit. Created by Jason Sawle.
import { docToWebMap, readWebMap, looksLikeWebMap, isOwnLayerJson, ITEM_LAYER_PREFIX, DATA_LAYER_PREFIX, SKETCH_GRAPHICS_ID,
  WEBMAP_WRITER_VERSION, WEBMAP_SPEC_VERSION, MAX_FEATURES } from "../lib/doc.js";
import { dataLayerDef } from "./add-data.js";

export { readWebMap, looksLikeWebMap, ITEM_LAYER_PREFIX, DATA_LAYER_PREFIX, SKETCH_GRAPHICS_ID, WEBMAP_WRITER_VERSION, WEBMAP_SPEC_VERSION, MAX_FEATURES };
export const KIT_VERSION = "1.1";   // 1.1: saves .amap files (opens .mmap too)
export const FILE_EXTENSION = ".amap";   // Atlas map; .mmap files (the extension before Atlas 1.7) open too
const OPEN_EXTENSIONS = [FILE_EXTENSION, ".mmap", ".json"];
const FILE_TYPES = [{ description: "Map", accept: { "application/json": OPEN_EXTENSIONS } }];
const SAVE_TYPES = [{ description: "Map", accept: { "application/json": [FILE_EXTENSION] } }];

// ============================================================ Files on the device
// Chrome and Edge: the File System Access API (choose a folder and name; Save overwrites the same file).
// Safari and Firefox: the file downloads instead, and opening uses an ordinary file input.
export const canChooseFolder = () => typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";

/**
 * Save web map JSON to a file. Call it straight from a click: browsers only show a file picker during a click, so pass
 * a function that builds the JSON (e.g. () => mapToWebMapJson(…)) and it runs after the picker has opened.
 * options: { handle (overwrite this file), saveAs (always ask), suggestedName (without extension) }
 * Returns { handle, name, result } (handle is null after a download; result is what the function returned),
 * or null when the person cancels.
 */
export async function saveWebMapFile(jsonOrBuilder, options) {
  const o = options || {};
  const base = String(o.suggestedName || "map").replace(/[^\w\- ]+/g, "_").trim().slice(0, 60) || "map";
  const build = async () => {
    const r = typeof jsonOrBuilder === "function" ? await jsonOrBuilder() : jsonOrBuilder;
    const json = r && r.json && r.json.operationalLayers ? r.json : r;
    return { blob: new Blob([JSON.stringify(json)], { type: "application/json" }), result: r };
  };
  if (canChooseFolder()) {
    let handle = o.saveAs ? null : o.handle || null;
    try {
      if (!handle) handle = await window.showSaveFilePicker({ suggestedName: base + FILE_EXTENSION, types: SAVE_TYPES });
      const { blob, result } = await build();
      const w = await handle.createWritable(); await w.write(blob); await w.close();
      return { handle, name: handle.name, result };
    } catch (e) {
      if (e && e.name === "AbortError") return null;
      if (e && (e.name === "NotAllowedError" || e.name === "NoModificationAllowedError") && !o.saveAs) return saveWebMapFile(jsonOrBuilder, { ...o, saveAs: true });   // read-only file
      throw e;
    }
  }
  const { blob, result } = await build();
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = base + FILE_EXTENSION; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { handle: null, name: base + FILE_EXTENSION, result };
}

/** Ask for a saved map and read it. Call it from a click. Returns { json, name, handle } or null when cancelled. */
export async function openWebMapFile() {
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: FILE_TYPES });
      const file = await handle.getFile();
      return { json: JSON.parse(await file.text()), name: file.name, handle };
    } catch (e) { if (e && e.name === "AbortError") return null; if (!(e instanceof SyntaxError)) return pickWithInput(); throw e; }
  }
  return pickWithInput();
}
function pickWithInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = OPEN_EXTENSIONS.join(",") + ",application/json";
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      try { resolve({ json: JSON.parse(await f.text()), name: f.name, handle: null }); } catch (e) { reject(e); }
    });
    input.click();
  });
}
/** A dropped or chosen File -> { json, name }. */
export async function readMapFile(file) { return { json: JSON.parse(await file.text()), name: file.name, handle: null }; }
/** "Field_trip-2.amap" -> "Field trip 2" (a web map has no title of its own; the file name is the map's name). */
export const titleFromFileName = (name) => String(name || "").replace(/\.(amap|mmap|json)$/i, "").replace(/[_-]+/g, " ").trim();

// ============================================================ Map -> web map JSON
const LAYER_TYPE_JSON = { feature: "ArcGISFeatureLayer", "map-image": "ArcGISMapServiceLayer", tile: "ArcGISTiledMapServiceLayer", "vector-tile": "VectorTileLayer",
  imagery: "ArcGISImageServiceLayer", "imagery-tile": "ArcGISTiledImageServiceLayer", csv: "CSV", geojson: "GeoJSON", kml: "KML", wms: "WMS", wfs: "WFS",
  "web-tile": "WebTiledLayer", "geo-rss": "GeoRSS", stream: "ArcGISStreamLayer", "ogc-feature": "OGCFeatureLayer" };

/** Operational layer JSON for a layer added from an item or a service (e.g. from Add layer). Returns null for types it can't write. */
export function layerToOperationalJson(layer) {
  const visibility = layer.visible !== false, opacity = typeof layer.opacity === "number" ? layer.opacity : 1;
  if (layer.atlasOpJson) return { ...layer.atlasOpJson, id: layer.id, title: layer.title || layer.atlasOpJson.title, visibility, opacity };
  const base = { id: layer.id, title: layer.title, visibility, opacity };
  if (layer.type === "group") { const layers = layer.layers.toArray().map(layerToOperationalJson).filter(Boolean); return layers.length ? { ...base, layerType: "GroupLayer", layers } : null; }
  const layerType = LAYER_TYPE_JSON[layer.type];
  if (!layerType) return null;
  const out = { ...base, layerType };
  if (layer.portalItem && layer.portalItem.id) out.itemId = layer.portalItem.id;
  if (layer.type === "feature") { if (layer.url) out.url = layer.layerId != null ? layer.url + "/" + layer.layerId : layer.url; }
  else if (layer.type === "vector-tile") { if (layer.url) out.styleUrl = /\.json(\?|$)/i.test(layer.url) ? layer.url : layer.url.replace(/\/?$/, "/resources/styles/root.json"); }
  else if (layer.type === "web-tile") { if (layer.urlTemplate) out.templateUrl = layer.urlTemplate; }
  else if (layer.url) out.url = layer.url;
  return out.url || out.styleUrl || out.templateUrl || out.itemId ? out : null;
}

/** The opened web map's own operational layers (sourceJson), with each layer's current visibility and transparency. */
export function sourceLayersJson(map, sourceJson) {
  const live = map.layers;
  return ((sourceJson && sourceJson.operationalLayers) || [])
    .filter((op) => !isOwnLayerJson(op) && !String(op.id || "").startsWith(ITEM_LAYER_PREFIX))
    .map((op) => { const l = live.find((x) => x.id === op.id); return l ? { ...op, visibility: l.visible !== false, opacity: l.opacity } : op; });
}

/**
 * The basemap as web map JSON: a basemap chosen from a gallery (a portal item) is read from its item; otherwise the opened
 * map's own basemap. fetchItemData(itemId) -> the item's /data JSON (e.g. with esriRequest). Returns null if unknown
 * (the writer then writes an empty basemap and the app's default is used when the file is opened).
 */
export async function basemapJson(map, options) {
  const o = options || {};
  const b = map.basemap, id = b && b.portalItem && b.portalItem.id;
  if (id && o.fetchItemData) { try { const d = await o.fetchItemData(id); if (d && d.baseMap) return d.baseMap; } catch (e) { /* fall through */ } }
  if (!id && o.sourceJson && o.sourceJson.baseMap) return o.sourceJson.baseMap;
  try { const j = b && b.toJSON && b.toJSON(); if (j && j.baseMapLayers && j.baseMapLayers.length) return j; } catch (e) { /* fall through */ }
  return null;
}

// ---------- Sketches
// The writer stores each sketch with these attributes, so it comes back editable:
//   { uid, kind: "point"|"polyline"|"polygon"|"text", title, description, imageUrl (embedded data: picture), color "#rrggbb", size, rotation }
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const toHex = (c) => (c && typeof c.toHex === "function" ? c.toHex() : Array.isArray(c) ? "#" + c.slice(0, 3).map(hex2).join("") : c && c.r != null ? "#" + [c.r, c.g, c.b].map(hex2).join("") : null);
/** Sketch attributes for a graphic: its own when present, otherwise read from its symbol (for sketches drawn by another tool). */
export function sketchAttributes(graphic) {
  const a = graphic.attributes || {}, sym = graphic.symbol || {}, gtype = graphic.geometry && graphic.geometry.type;
  if (a.kind && a.color) return { ...a };
  const text = sym.type === "text";
  const color = toHex(sym.type === "simple-fill" && sym.outline ? sym.outline.color : sym.color) || "#0079c1";
  const size = text ? (sym.font && sym.font.size) || 16 : sym.type === "simple-line" ? (sym.width || 3) * 4 : sym.size || 12;
  return { uid: a.uid || "f" + Math.random().toString(36).slice(2, 10), kind: text ? "text" : gtype === "polyline" || gtype === "polygon" ? gtype : "point",
    title: text ? sym.text || "" : a.title || a.name || "", description: a.description || "", imageUrl: a.imageUrl || "", color, size, rotation: sym.angle || 0 };
}
/** Sketch graphic JSON (from readWebMap) -> a Graphic with its symbol and pop-up. Graphic: the SDK class. */
export function sketchGraphic(gj, Graphic) {
  const a = gj.attributes, color = a.color || "#0079c1", size = a.size || 12;
  const n = parseInt(color.slice(1), 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const kind = a.kind === "text" ? "text" : gj.geometry.paths ? "polyline" : gj.geometry.rings ? "polygon" : "point";
  const symbol = kind === "text" ? { type: "text", text: a.title || "Text", color, haloColor: "#ffffff", haloSize: 1.5, angle: a.rotation || 0, font: { size: Math.max(10, size), weight: "bold" } }
    : kind === "polyline" ? { type: "simple-line", color, width: Math.max(2, Math.round(size / 4)) }
    : kind === "polygon" ? { type: "simple-fill", color: [rgb[0], rgb[1], rgb[2], 0.25], outline: { color, width: 2 } }
    : { type: "simple-marker", style: "circle", color, size, angle: a.rotation || 0, outline: { color: "#ffffff", width: 1.5 } };
  const g = Graphic.fromJSON({ geometry: gj.geometry, attributes: a });
  g.attributes = { ...a }; g.symbol = symbol;
  g.popupTemplate = { title: "{title}", content: (ev) => {
    const at = (ev && ev.graphic && ev.graphic.attributes) || {}, div = document.createElement("div");
    if (at.description) { const p = document.createElement("p"); p.style.whiteSpace = "pre-wrap"; p.textContent = at.description; div.appendChild(p); }
    if (/^data:image\//.test(at.imageUrl || "")) { const img = document.createElement("img"); img.src = at.imageUrl; img.alt = at.title || ""; img.style.maxWidth = "100%"; div.appendChild(img); }
    return div;
  } };
  return g;
}

/**
 * Everything on the map as web map JSON.
 * options:
 *   view           MapView (the saved view: extent, scale, rotation)
 *   sourceJson     JSON of the web map that was opened (its /data, or the file's JSON); null for a new map
 *   sketchLayer    GraphicsLayer of sketches (optional);  sketchTitle  its name in the saved map
 *   dataLayers     layers from createDataLayer (spreadsheets)
 *   addedLayers    layers added from items or services (written with layerToOperationalJson; give them id "__item_<itemId>")
 *   bookmarks      [{ title, viewpoint: { center: [lon, lat], zoom } | { extent }, layers: [{ id, visible }], thumb: "data:image/…" }]
 *   fetchItemData  itemId -> item /data JSON (for the basemap);  appName / appVersion  written as authoringApp / authoringAppVersion
 * Returns { json, skippedLayers } (skippedLayers: added layers of a type that can't be written).
 */
export async function mapToWebMapJson(options) {
  const o = options || {}, view = o.view, map = view.map;
  const added = (o.addedLayers || []).map(layerToOperationalJson);
  const doc = {
    graphics: o.sketchLayer ? o.sketchLayer.graphics.toArray().map((g) => ({ geometry: g.geometry.toJSON(), attributes: sketchAttributes(g) })) : [],
    layers: (o.dataLayers || []).map(dataLayerDef).filter(Boolean),
    bookmarks: o.bookmarks || []
  };
  const ext = view.extent ? view.extent.clone().toJSON() : null;
  const json = docToWebMap(doc, { baseMap: await basemapJson(map, { sourceJson: o.sourceJson, fetchItemData: o.fetchItemData }),
    sourceLayers: sourceLayersJson(map, o.sourceJson), portalLayers: added.filter(Boolean), extent: ext,
    scale: view.type === "2d" ? view.scale : null, rotation: view.type === "2d" ? view.rotation || 0 : 0,
    appVersion: o.appVersion || KIT_VERSION, sketchTitle: o.sketchTitle || "Sketches", sketchVisible: !o.sketchLayer || o.sketchLayer.visible !== false });
  if (o.appName) json.authoringApp = String(o.appName);
  return { json, skippedLayers: added.filter((x) => !x).length };
}

// ============================================================ Web map JSON -> map
/**
 * Check a web map from a file and load it. Files from anywhere are checked first (readWebMap): https-only layers and
 * pictures, known layer types, picture symbols replaced, MAX_FEATURES features.
 * sdk: { WebMap, Basemap };  options: { trusted (an ArcGIS Online item's data), defaultBasemap (used when the file has none) }
 * Returns { ok:false, code } or { ok:true, webmap (loaded WebMap), json (checked JSON, keep it as sourceJson for saving),
 *   graphics (for sketchGraphic), layers (for createDataLayer), bookmarks, sketchVisible, skipped }.
 * Layers whose id starts "__item_" were added from items: find them in webmap.layers and keep them with your added layers.
 */
export async function loadWebMapJson(raw, sdk, options) {
  const o = options || {};
  const parsed = readWebMap(raw, { trusted: !!o.trusted });
  if (!parsed.ok) return parsed;
  const webmap = sdk.WebMap.fromJSON(parsed.webmap);
  if (!parsed.webmap.baseMap && o.defaultBasemap) webmap.basemap = o.defaultBasemap;
  await webmap.load();
  for (const l of webmap.layers.toArray()) {
    if (typeof l.id === "string" && l.id.startsWith(ITEM_LAYER_PREFIX)) l.atlasOpJson = (parsed.webmap.operationalLayers || []).find((op) => op.id === l.id) || null;
  }
  return { ...parsed, webmap, json: parsed.webmap };
}
