// Saved map documents (.mmap) and their conversion to and from ArcGIS web map JSON.
// Pure functions only (no ArcGIS SDK), so they can be unit-tested in Node.

export const DOC_TYPE = "MapMakerLocalDocument";
export const DOC_VERSION = 4;          // 4 = adds source web map, layer states, portal layers, 2D/3D mode; reads 2, 3 and Map Studio's 4
export const WEBMAP_WRITER_VERSION = "1.0";
export const AUTHORING_APP = "AtlasWhiteLabel";
export const MAX_FEATURES = 5000;      // per file: protects school devices from huge or hostile files

const HEX32 = /^[0-9a-f]{32}$/i;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const SR = { wkid: 102100, latestWkid: 3857 };
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const str = (v, max) => (typeof v === "string" ? v.slice(0, max || 500) : "");
const clamp = (n, lo, hi, d) => (finite(n) ? Math.min(hi, Math.max(lo, n)) : d);

// ---------------------------------------------------------------- hardening of opened files

function cleanGeometry(g) {
  if (!g || typeof g !== "object") return null;
  const sr = g.spatialReference && finite(g.spatialReference.wkid) ? { wkid: g.spatialReference.wkid, latestWkid: g.spatialReference.latestWkid } : SR;
  const pts = (arr) => Array.isArray(arr) && arr.every((p) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]));
  if (finite(g.x) && finite(g.y)) return { x: g.x, y: g.y, spatialReference: sr };
  if (Array.isArray(g.paths) && g.paths.length && g.paths.every(pts)) return { paths: g.paths.map((p) => p.map((c) => [c[0], c[1]])), spatialReference: sr };
  if (Array.isArray(g.rings) && g.rings.length && g.rings.every(pts)) return { rings: g.rings.map((r) => r.map((c) => [c[0], c[1]])), spatialReference: sr };
  return null;
}
export function geometryKind(g) { return g && g.paths ? "polyline" : g && g.rings ? "polygon" : "point"; }

function rgbToHex(c) {
  if (!Array.isArray(c) || c.length < 3) return null;
  return "#" + c.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
}
export function cleanSketchAttributes(a, geometry, symbol) {
  a = a && typeof a === "object" ? a : {};
  let color = HEX_COLOR.test(a.color) ? a.color.toLowerCase() : null;
  if (!color && symbol && symbol.color) color = rgbToHex(symbol.color);   // Map Studio files keep colour in the symbol
  const kind = ["point", "polyline", "polygon", "text"].includes(a.kind) ? a.kind : geometryKind(geometry);
  return {
    uid: str(a.uid, 40) || "f" + Math.random().toString(36).slice(2, 10),
    kind: kind === "text" && geometryKind(geometry) !== "point" ? geometryKind(geometry) : kind,
    title: str(a.title, 300), description: str(a.description, 5000),
    imageUrl: typeof a.imageUrl === "string" && DATA_IMAGE.test(a.imageUrl) && a.imageUrl.length < 3e6 ? a.imageUrl : "",
    color: color || "#0079c1", size: clamp(a.size, 4, 64, 12), rotation: clamp(a.rotation, 0, 360, 0)
  };
}

// Replace picture symbols (which could load images from any web address) with plain ones.
function scrubSymbols(o, depth) {
  if (!o || typeof o !== "object" || depth > 12) return o;
  if (Array.isArray(o)) return o.map((x) => scrubSymbols(x, depth + 1));
  if (o.type === "esriPMS" || o.type === "picture-marker") return { type: "esriSMS", style: "esriSMSCircle", color: [0, 122, 194, 220], size: 10, outline: { color: [255, 255, 255, 255], width: 1 } };
  if (o.type === "esriPFS" || o.type === "picture-fill") return { type: "esriSFS", style: "esriSFSSolid", color: [0, 122, 194, 80], outline: { type: "esriSLS", style: "esriSLSSolid", color: [0, 122, 194, 255], width: 1 } };
  const out = {};
  for (const k of Object.keys(o)) { if (k === "url" || k === "imageData") continue; out[k] = scrubSymbols(o[k], depth + 1); }
  return out;
}
const FIELD_TYPES = ["esriFieldTypeOID", "esriFieldTypeString", "esriFieldTypeInteger", "esriFieldTypeSmallInteger", "esriFieldTypeDouble",
  "esriFieldTypeSingle", "esriFieldTypeDate", "oid", "string", "integer", "small-integer", "double", "single", "date"];
function cleanFields(fields) {
  return (Array.isArray(fields) ? fields : []).filter((f) => f && /^[A-Za-z_][\w]{0,63}$/.test(f.name) && FIELD_TYPES.includes(f.type))
    .map((f) => { const o = { name: f.name, alias: str(f.alias || f.name, 200), type: f.type }; if (finite(f.length)) o.length = f.length; return o; });
}
function cleanPopupInfo(p, fields) {
  const names = new Set(fields.map((f) => f.name));
  const infos = (p && (p.fieldInfos || (p.content && p.content[0] && p.content[0].fieldInfos))) || [];
  const fieldInfos = (Array.isArray(infos) ? infos : []).filter((fi) => fi && names.has(fi.fieldName))
    .map((fi) => ({ fieldName: fi.fieldName, label: str(fi.label || fi.fieldName, 200), visible: fi.visible !== false }));
  return { title: str(p && p.title, 300), content: [{ type: "fields", fieldInfos }], fieldInfos };
}
export function cleanDataLayer(ld, budget) {
  if (!ld || typeof ld !== "object") return null;
  const fields = cleanFields(ld.fields);
  const gtype = ["point", "polyline", "polygon"].includes(ld.geometryType) ? ld.geometryType
    : ({ esriGeometryPoint: "point", esriGeometryPolyline: "polyline", esriGeometryPolygon: "polygon" })[ld.geometryType] || "point";
  const names = new Set(fields.map((f) => f.name));
  const feats = [];
  for (const f of Array.isArray(ld.features) ? ld.features : []) {
    if (budget.left <= 0) break;
    const geometry = cleanGeometry(f && f.geometry);
    if (!geometry) continue;
    const attrs = {};
    for (const k of Object.keys((f && f.attributes) || {})) {
      if (!names.has(k) && k !== "_pieTotal") continue;
      const v = f.attributes[k];
      attrs[k] = typeof v === "string" ? v.slice(0, 5000) : finite(v) ? v : null;
    }
    feats.push({ geometry, attributes: attrs }); budget.left--;
  }
  return {
    id: /^[\w-]{1,40}$/.test(ld.id || "") ? ld.id : "csv" + Math.random().toString(36).slice(2, 8),
    title: str(ld.title, 200) || "Data", geometryType: gtype,
    objectIdField: typeof ld.objectIdField === "string" && names.has(ld.objectIdField) ? ld.objectIdField : undefined,
    spatialReference: SR, fields,
    renderer: ld.renderer ? scrubSymbols(ld.renderer, 0) : null,
    labelingInfo: Array.isArray(ld.labelingInfo) ? scrubSymbols(ld.labelingInfo, 0) : null,
    popupInfo: cleanPopupInfo(ld.popupInfo, fields),
    features: feats,
    visible: ld.visible !== false, opacity: clamp(ld.opacity, 0, 1, 1)
  };
}
function cleanViewpoint(vp) {
  if (!vp || typeof vp !== "object") return null;
  if (Array.isArray(vp.center) && finite(vp.center[0]) && finite(vp.center[1]) && finite(vp.zoom))
    return { center: [clamp(vp.center[0], -540, 540, 0), clamp(vp.center[1], -90, 90, 0)], zoom: clamp(vp.zoom, 0, 24, 3) };
  const e = vp.extent;
  if (e && ["xmin", "ymin", "xmax", "ymax"].every((k) => finite(e[k])))
    return { extent: { xmin: e.xmin, ymin: e.ymin, xmax: e.xmax, ymax: e.ymax, spatialReference: e.spatialReference && finite(e.spatialReference.wkid) ? { wkid: e.spatialReference.wkid } : SR } };
  return null;
}
function cleanCamera(c) {
  if (!c || !c.position || !finite(c.position.x) || !finite(c.position.y)) return null;
  return { position: { x: c.position.x, y: c.position.y, z: finite(c.position.z) ? c.position.z : 0, spatialReference: c.position.spatialReference && finite(c.position.spatialReference.wkid) ? { wkid: c.position.spatialReference.wkid } : SR },
    heading: clamp(c.heading, -360, 360, 0), tilt: clamp(c.tilt, 0, 180, 0), fov: clamp(c.fov, 1, 170, 55) };
}
function cleanLayerList(list) {
  return (Array.isArray(list) ? list : []).slice(0, 200).filter((l) => l && typeof l.id === "string")
    .map((l) => ({ id: l.id.slice(0, 120), title: str(l.title, 200), visible: l.visible !== false }));
}
export function cleanBasemap(b) {
  if (typeof b === "string") {
    if (b.startsWith("item:") && HEX32.test(b.slice(5))) return b;
    if (/^[a-z][a-z0-9-]{1,40}$/.test(b)) return b;                    // well-known basemap id
    return null;
  }
  if (b && HEX32.test(b.itemId || "")) return "item:" + b.itemId;     // Map Studio format
  return null;
}

export function cleanBookmarks(list) {
  return (Array.isArray(list) ? list : []).slice(0, 100).map((bm) => {
    const viewpoint = cleanViewpoint(bm && bm.viewpoint);
    if (!viewpoint) return null;
    return { title: str(bm.title, 200) || "Bookmark", viewpoint, layers: cleanLayerList(bm.layers),
      thumb: typeof bm.thumb === "string" && DATA_IMAGE.test(bm.thumb) && bm.thumb.length < 400000 ? bm.thumb : null };
  }).filter(Boolean);
}

/** Validate an opened .mmap. Returns { ok:true, doc, skipped } or { ok:false, code }. */
export function sanitizeDoc(raw) {
  if (!raw || typeof raw !== "object" || raw.type !== DOC_TYPE) return { ok: false, code: "notMapFile" };
  const budget = { left: MAX_FEATURES };
  let skipped = 0;
  const graphics = [];
  for (const gj of (Array.isArray(raw.graphics) ? raw.graphics : Array.isArray(raw.sketch) ? raw.sketch : [])) {
    if (budget.left <= 0) { skipped++; continue; }
    const geometry = cleanGeometry(gj && gj.geometry);
    if (!geometry) { skipped++; continue; }
    graphics.push({ geometry, attributes: cleanSketchAttributes(gj.attributes, geometry, gj.symbol) }); budget.left--;
  }
  const layers = [];
  for (const ld of Array.isArray(raw.layers) ? raw.layers : []) { const c = cleanDataLayer(ld, budget); if (c && c.features.length) layers.push(c); else skipped++; }
  const totalIn = (raw.layers || []).reduce((n, l) => n + ((l && Array.isArray(l.features) && l.features.length) || 0), 0);
  const totalOut = layers.reduce((n, l) => n + l.features.length, 0);
  if (totalIn > totalOut) skipped += totalIn - totalOut;
  const doc = {
    type: DOC_TYPE, version: DOC_VERSION, title: str(raw.title, 200) || "", description: str(raw.description, 5000),
    basemap: cleanBasemap(raw.basemap), mode: raw.mode === "3d" ? "3d" : "2d",
    viewpoint: cleanViewpoint(raw.viewpoint), camera: cleanCamera(raw.camera),
    webmap: raw.webmap && HEX32.test(raw.webmap.itemId || "") ? { itemId: raw.webmap.itemId, title: str(raw.webmap.title, 200) } : null,
    layerStates: (Array.isArray(raw.layerStates) ? raw.layerStates : []).slice(0, 300).filter((s) => s && typeof s.id === "string")
      .map((s) => ({ id: s.id.slice(0, 120), title: str(s.title, 200), visible: s.visible !== false, opacity: clamp(s.opacity, 0, 1, 1) })),
    portalLayers: (Array.isArray(raw.portalLayers) ? raw.portalLayers : []).slice(0, 50).filter((p) => p && HEX32.test(p.itemId || ""))
      .map((p) => ({ itemId: p.itemId, type: str(p.type, 60), title: str(p.title, 200), visible: p.visible !== false, opacity: clamp(p.opacity, 0, 1, 1) })),
    sketchVisible: raw.sketchVisible !== false,
    graphics, layers,
    bookmarks: cleanBookmarks(raw.bookmarks)
  };
  return { ok: true, doc, skipped };
}

// ---------------------------------------------------------------- web map JSON (ArcGIS Online save)

const hexToRgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]; };
const ESRI_GEOM = { point: "esriGeometryPoint", polyline: "esriGeometryPolyline", polygon: "esriGeometryPolygon" };
const SKETCH_FIELDS = [
  { name: "ObjectId", alias: "ObjectId", type: "esriFieldTypeOID" },
  { name: "uid", alias: "uid", type: "esriFieldTypeString", length: 40 },
  { name: "kind", alias: "kind", type: "esriFieldTypeString", length: 20 },
  { name: "title", alias: "Title", type: "esriFieldTypeString", length: 300 },
  { name: "description", alias: "Description", type: "esriFieldTypeString", length: 5000 },
  { name: "imageUrl", alias: "Image", type: "esriFieldTypeString", length: 3000000 },
  { name: "color", alias: "color", type: "esriFieldTypeString", length: 7 },
  { name: "size", alias: "size", type: "esriFieldTypeDouble" },
  { name: "rotation", alias: "rotation", type: "esriFieldTypeDouble" },
  { name: "_style", alias: "_style", type: "esriFieldTypeString", length: 40 }
];
export const SKETCH_LAYER_PREFIX = "__sketch_";

function sketchSymbol(kind, a) {
  if (kind === "polyline") return { type: "esriSLS", style: "esriSLSSolid", color: hexToRgba(a.color, 255), width: Math.max(1.5, Math.round(a.size / 4)) };
  if (kind === "polygon") return { type: "esriSFS", style: "esriSFSSolid", color: hexToRgba(a.color, 64), outline: { type: "esriSLS", style: "esriSLSSolid", color: hexToRgba(a.color, 255), width: 2 } };
  return { type: "esriSMS", style: "esriSMSCircle", color: hexToRgba(a.color, 255), size: a.size, angle: a.rotation || 0,
    outline: { type: "esriSLS", style: "esriSLSSolid", color: [255, 255, 255, 255], width: 1.1 } };
}
function styleKey(kind, a) { return kind === "polygon" ? a.color : kind === "polyline" ? a.color + "|" + a.size : a.color + "|" + a.size + "|" + (a.rotation || 0); }

/** Sketch graphics -> up to four feature-collection layers (points, lines, areas, text). */
export function sketchToOperationalLayers(graphics, title, visible) {
  const groups = { point: [], polyline: [], polygon: [], text: [] };
  for (const g of graphics) { const k = g.attributes.kind === "text" ? "text" : geometryKind(g.geometry); groups[k].push(g); }
  const names = { point: "points", polyline: "lines", polygon: "areas", text: "text" };
  const out = [];
  for (const k of Object.keys(groups)) {
    const list = groups[k];
    if (!list.length) continue;
    const gkind = k === "text" ? "point" : k;
    const feats = list.map((g, i) => {
      const a = g.attributes;
      return { geometry: g.geometry, attributes: { ObjectId: i + 1, uid: a.uid, kind: a.kind, title: a.title, description: a.description,
        imageUrl: a.imageUrl || "", color: a.color, size: a.size, rotation: a.rotation || 0, _style: k === "text" ? a.color + "|" + a.size : styleKey(gkind, a) } };
    });
    const layerDefinition = { name: (title || "Sketches") + " (" + names[k] + ")", type: "Feature Layer", geometryType: ESRI_GEOM[gkind],
      objectIdField: "ObjectId", fields: SKETCH_FIELDS, drawingInfo: {} };
    if (k === "text") {
      layerDefinition.drawingInfo.renderer = { type: "simple", symbol: { type: "esriSMS", style: "esriSMSCircle", color: [0, 0, 0, 0], size: 1, outline: { type: "esriSLS", style: "esriSLSNull", color: [0, 0, 0, 0], width: 0 } } };
      const classes = [...new Set(feats.map((f) => f.attributes._style))];
      layerDefinition.drawingInfo.labelingInfo = classes.map((key) => {
        const [color, size] = key.split("|");
        return { where: "_style = '" + key.replace(/'/g, "''") + "'", labelExpressionInfo: { expression: "$feature.title" }, labelPlacement: "esriServerPointLabelPlacementCenterCenter",
          symbol: { type: "esriTS", color: hexToRgba(color, 255), haloColor: [255, 255, 255, 255], haloSize: 1.5, font: { family: "Arial", size: Math.max(10, Number(size)), weight: "bold" } } };
      });
      layerDefinition.showLabels = true;
    } else {
      const seen = new Map();
      for (const f of feats) if (!seen.has(f.attributes._style)) seen.set(f.attributes._style, f.attributes);
      layerDefinition.drawingInfo.renderer = { type: "uniqueValue", field1: "_style",
        uniqueValueInfos: [...seen.entries()].map(([key, a]) => ({ value: key, label: "", symbol: sketchSymbol(gkind, a) })) };
    }
    out.push({
      id: SKETCH_LAYER_PREFIX + names[k], title: (title || "Sketches") + (k === "point" ? "" : " (" + names[k] + ")"),
      layerType: "ArcGISFeatureLayer", visibility: visible !== false, opacity: 1, showLegend: false, showLabels: k === "text",
      featureCollection: { layers: [{ layerDefinition, featureSet: { geometryType: ESRI_GEOM[gkind], features: feats },
        popupInfo: { title: "{title}", description: "{description}", fieldInfos: [{ fieldName: "title", visible: true }, { fieldName: "description", visible: true }], showAttachments: false } }] }
    });
  }
  return out;
}
/** Feature-collection layers written by sketchToOperationalLayers -> editable sketch graphics again. */
export function operationalLayersToSketch(opLayers) {
  const graphics = [];
  for (const op of opLayers) {
    if (!op || typeof op.id !== "string" || !op.id.startsWith(SKETCH_LAYER_PREFIX)) continue;
    for (const lyr of (op.featureCollection && op.featureCollection.layers) || []) {
      for (const f of (lyr.featureSet && lyr.featureSet.features) || []) {
        const geometry = cleanGeometry(f.geometry);
        if (geometry) graphics.push({ geometry, attributes: cleanSketchAttributes(f.attributes, geometry) });
      }
    }
  }
  return graphics;
}
export const DATA_LAYER_ROLE = "atlasData";
/** Saved data layer definition -> feature-collection operational layer. */
export function dataDefToOperationalLayer(def, visible, opacity) {
  const gtype = def.geometryType || "point";
  const popup = def.popupInfo || {};
  const fieldInfos = popup.fieldInfos || (popup.content && popup.content[0] && popup.content[0].fieldInfos) || [];
  const drawingInfo = {};
  if (def.renderer) drawingInfo.renderer = def.renderer;
  if (def.labelingInfo) drawingInfo.labelingInfo = def.labelingInfo;
  return {
    id: "__data_" + def.id, title: def.title, layerType: "ArcGISFeatureLayer", visibility: visible !== false, opacity: finite(opacity) ? opacity : 1,
    showLabels: !!def.labelingInfo, atlasRole: DATA_LAYER_ROLE,
    featureCollection: { layers: [{
      layerDefinition: { name: def.title, type: "Feature Layer", geometryType: ESRI_GEOM[gtype] || gtype, objectIdField: def.objectIdField || "ObjectId",
        fields: def.fields, drawingInfo, showLabels: !!def.labelingInfo },
      featureSet: { geometryType: ESRI_GEOM[gtype] || gtype, features: def.features },
      popupInfo: { title: popup.title || "", fieldInfos, popupElements: [{ type: "fields" }], showAttachments: false }
    }] }
  };
}
export function operationalLayerToDataDef(op) {
  const lyr = op && op.featureCollection && op.featureCollection.layers && op.featureCollection.layers[0];
  if (!lyr) return null;
  const ld = lyr.layerDefinition || {};
  return cleanDataLayer({
    id: String(op.id || "").replace(/^__data_/, ""), title: op.title || ld.name, geometryType: ld.geometryType, objectIdField: ld.objectIdField,
    fields: ld.fields, renderer: ld.drawingInfo && ld.drawingInfo.renderer, labelingInfo: ld.drawingInfo && ld.drawingInfo.labelingInfo,
    popupInfo: lyr.popupInfo, features: lyr.featureSet && lyr.featureSet.features, visible: op.visibility !== false, opacity: op.opacity
  }, { left: MAX_FEATURES });
}
export function isOwnLayerJson(op) { return !!op && typeof op.id === "string" && (op.id.startsWith(SKETCH_LAYER_PREFIX) || op.id.startsWith("__data_")); }

// Web Mercator helpers for bookmarks stored as centre + zoom.
const R = 6378137, ORIGIN = 20037508.342788905;
export function lonLatToXY(lon, lat) { const la = Math.max(-85.0511, Math.min(85.0511, lat)); return [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) * R]; }
export function xyToLonLat(x, y) { return [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI]; }
export function zoomToScale(z) { return 591657527.591555 / Math.pow(2, z); }
export function scaleToZoom(s) { return Math.log2(591657527.591555 / s); }
function extentFor(center, zoom, w, h) {
  const res = (2 * ORIGIN / 256) / Math.pow(2, zoom);
  const [x, y] = lonLatToXY(center[0], center[1]);
  return { xmin: x - res * w / 2, ymin: y - res * h / 2, xmax: x + res * w / 2, ymax: y + res * h / 2, spatialReference: SR };
}
export function bookmarksToSpec(bookmarks) {
  return bookmarks.map((bm) => {
    const vp = bm.viewpoint;
    const extent = vp.extent || extentFor(vp.center, vp.zoom, 1280, 720);
    const out = { name: bm.title, extent };
    if (vp.center) { const [x, y] = lonLatToXY(vp.center[0], vp.center[1]); out.viewpoint = { targetGeometry: { x, y, spatialReference: SR }, scale: zoomToScale(vp.zoom) }; }
    else out.viewpoint = { targetGeometry: vp.extent };
    return out;
  });
}
export function specToBookmarks(list) {
  return (Array.isArray(list) ? list : []).map((b) => {
    if (!b) return null;
    const tg = b.viewpoint && b.viewpoint.targetGeometry;
    let viewpoint = null;
    if (tg && finite(tg.x) && finite(tg.y) && b.viewpoint.scale && (!tg.spatialReference || [102100, 3857].includes(tg.spatialReference.wkid))) {
      const ll = xyToLonLat(tg.x, tg.y); viewpoint = { center: ll, zoom: scaleToZoom(b.viewpoint.scale) };
    } else viewpoint = cleanViewpoint({ extent: (tg && tg.xmin !== undefined ? tg : b.extent) });
    return viewpoint ? { title: str(b.name, 200) || "Bookmark", viewpoint, layers: [], thumb: null } : null;
  }).filter(Boolean);
}

/**
 * Build a web map from the current document.
 * ctx: { baseMap, sourceLayers (operational layer JSON from the opened web map), portalLayers (JSON), extent, appVersion, sketchTitle }
 */
export function docToWebMap(doc, ctx) {
  const operationalLayers = []
    .concat((ctx.sourceLayers || []).filter((op) => !isOwnLayerJson(op)))
    .concat(ctx.portalLayers || [])
    .concat((doc.layers || []).map((ld) => dataDefToOperationalLayer(ld, ld.visible, ld.opacity)))
    .concat(sketchToOperationalLayers(doc.graphics || [], ctx.sketchTitle, ctx.sketchVisible));
  const wm = {
    operationalLayers, baseMap: ctx.baseMap, spatialReference: SR, version: "2.31",
    authoringApp: AUTHORING_APP, authoringAppVersion: ctx.appVersion || WEBMAP_WRITER_VERSION,
    initialState: { viewpoint: { targetGeometry: ctx.extent } }
  };
  if (doc.bookmarks && doc.bookmarks.length) {
    wm.bookmarks = bookmarksToSpec(doc.bookmarks);
    wm.atlasBookmarks = doc.bookmarks.map((b) => ({ title: b.title, viewpoint: b.viewpoint, layers: b.layers || [] }));   // keeps layer on/off per bookmark
  }
  return wm;
}
