// Saved maps are ArcGIS web maps: the same JSON (Web Map Specification) whether saved to an .amap file on the
// device or to ArcGIS Online. This file writes and reads that JSON, and still reads the older .mmap documents.
// Pure functions only (no ArcGIS SDK), so they can be unit-tested in Node.

export const DOC_TYPE = "MapMakerLocalDocument";   // the older .mmap format (read only)
export const DOC_VERSION = 4;          // last version of the older format; reads 2, 3 and Map Studio's 4
export const WEBMAP_WRITER_VERSION = "2.0";        // 2.0 = the saved file (.amap; .mmap before 1.7) is a web map; spec-only properties
export const WEBMAP_SPEC_VERSION = "2.31";
export const ITEM_LAYER_PREFIX = "__item_";        // layers added from the collection
export const DATA_LAYER_PREFIX = "__data_";        // spreadsheet (CSV) layers
export const SKETCH_GRAPHICS_ID = "__sketch";      // the sketch layer while editing (saved as __sketch_points, …)
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
// Pop-up for sketches in other ArcGIS apps (this app rebuilds its own): title, description and, when used, the picture.
function sketchPopupInfo(withImage) {
  const image = { type: "image", title: "", caption: "", value: { sourceURL: "{imageUrl}" } };
  const info = { title: "{title}", description: "{description}", fieldInfos: [{ fieldName: "title", label: "Title", visible: true }, { fieldName: "description", label: "Description", visible: true }],
    popupElements: [{ type: "text", text: "{description}" }], showAttachments: false };
  if (withImage) { info.mediaInfos = [image]; info.popupElements.push({ type: "media", mediaInfos: [image] }); }
  return info;
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
      featureCollection: { showLegend: false, layers: [{ layerDefinition, featureSet: { geometryType: ESRI_GEOM[gkind], features: feats }, nextObjectId: feats.length + 1,
        popupInfo: sketchPopupInfo(list.some((g) => g.attributes.imageUrl)) }] }
    });
  }
  return out;
}
/** Feature-collection layers written by sketchToOperationalLayers -> editable sketch graphics again. */
export function operationalLayersToSketch(opLayers, budget) {
  budget = budget || { left: MAX_FEATURES };
  const graphics = [];
  for (const op of opLayers) {
    if (!op || typeof op.id !== "string" || !op.id.startsWith(SKETCH_LAYER_PREFIX)) continue;
    for (const lyr of (op.featureCollection && op.featureCollection.layers) || []) {
      for (const f of (lyr.featureSet && lyr.featureSet.features) || []) {
        if (budget.left <= 0) break;
        const geometry = cleanGeometry(f && f.geometry);
        if (geometry) { graphics.push({ geometry, attributes: cleanSketchAttributes(f.attributes, geometry) }); budget.left--; }
      }
    }
  }
  return graphics;
}
/** Saved data layer definition -> feature-collection operational layer. */
export function dataDefToOperationalLayer(def, visible, opacity) {
  const gtype = def.geometryType || "point";
  const popup = def.popupInfo || {};
  const fieldInfos = popup.fieldInfos || (popup.content && popup.content[0] && popup.content[0].fieldInfos) || [];
  const drawingInfo = {};
  if (def.renderer) drawingInfo.renderer = def.renderer;
  if (def.labelingInfo) drawingInfo.labelingInfo = def.labelingInfo;
  return {
    id: DATA_LAYER_PREFIX + def.id, title: def.title, layerType: "ArcGISFeatureLayer", visibility: visible !== false, opacity: finite(opacity) ? opacity : 1,
    showLabels: !!def.labelingInfo,
    featureCollection: { layers: [{
      layerDefinition: { name: def.title, type: "Feature Layer", geometryType: ESRI_GEOM[gtype] || gtype, objectIdField: def.objectIdField || "ObjectId",
        fields: def.fields, drawingInfo },
      featureSet: { geometryType: ESRI_GEOM[gtype] || gtype, features: def.features },
      nextObjectId: (def.features || []).length + 1,
      popupInfo: { title: popup.title || "", fieldInfos, popupElements: [{ type: "fields" }], showAttachments: false }
    }] }
  };
}
export function operationalLayerToDataDef(op, budget) {
  const lyr = op && op.featureCollection && op.featureCollection.layers && op.featureCollection.layers[0];
  if (!lyr) return null;
  const ld = lyr.layerDefinition || {};
  return cleanDataLayer({
    id: String(op.id || "").replace(/^__data_/, ""), title: op.title || ld.name, geometryType: ld.geometryType, objectIdField: ld.objectIdField,
    fields: ld.fields, renderer: ld.drawingInfo && ld.drawingInfo.renderer, labelingInfo: ld.drawingInfo && ld.drawingInfo.labelingInfo,
    popupInfo: lyr.popupInfo, features: lyr.featureSet && lyr.featureSet.features, visible: op.visibility !== false, opacity: op.opacity
  }, budget || { left: MAX_FEATURES });
}
export function isOwnLayerJson(op) { return !!op && typeof op.id === "string" && (op.id.startsWith(SKETCH_LAYER_PREFIX) || op.id.startsWith(DATA_LAYER_PREFIX)); }

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
    if (typeof bm.thumb === "string" && DATA_IMAGE.test(bm.thumb)) out.thumbnail = { url: bm.thumb };
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
    const th = b.thumbnail && b.thumbnail.url;
    return viewpoint ? { title: str(b.name, 200) || "Bookmark", viewpoint, layers: [],
      thumb: typeof th === "string" && DATA_IMAGE.test(th) && th.length < 400000 ? th : null } : null;
  }).filter(Boolean);
}

/**
 * Build a web map (Web Map Specification) from the current document. Used for both the .amap file and ArcGIS Online.
 * ctx: { baseMap, sourceLayers (operational layers of the opened map, with current visibility), portalLayers (JSON),
 *        extent, rotation, scale, appVersion, sketchTitle, sketchVisible }
 * Each bookmark's layers on/off are kept as a presentation slide with the same index (the spec's bookmark has no layer list).
 */
export function docToWebMap(doc, ctx) {
  const dataOps = (doc.layers || []).map((ld) => dataDefToOperationalLayer(ld, ld.visible, ld.opacity));
  const sketchOps = sketchToOperationalLayers(doc.graphics || [], ctx.sketchTitle, ctx.sketchVisible);
  const operationalLayers = []
    .concat((ctx.sourceLayers || []).filter((op) => !isOwnLayerJson(op)))
    .concat(ctx.portalLayers || [])
    .concat(dataOps, sketchOps);
  const wm = {
    operationalLayers,
    baseMap: ctx.baseMap && Array.isArray(ctx.baseMap.baseMapLayers) ? ctx.baseMap : { baseMapLayers: [], title: "Basemap" },
    spatialReference: SR, version: WEBMAP_SPEC_VERSION,
    authoringApp: AUTHORING_APP, authoringAppVersion: String(ctx.appVersion || WEBMAP_WRITER_VERSION)
  };
  if (ctx.extent) {
    const viewpoint = { targetGeometry: ctx.extent };
    if (finite(ctx.scale) && ctx.scale > 0) viewpoint.scale = ctx.scale;
    if (finite(ctx.rotation) && ctx.rotation) viewpoint.rotation = ctx.rotation;
    wm.initialState = { viewpoint };
  }
  const bms = doc.bookmarks || [];
  if (bms.length) {
    wm.bookmarks = bookmarksToSpec(bms);
    if (bms.some((b) => b.layers && b.layers.length)) {
      const ids = new Set(operationalLayers.map((o) => o.id)), sketchIds = sketchOps.map((o) => o.id);
      wm.presentation = { slides: bms.map((b, i) => {
        const slide = { title: { text: b.title }, extent: wm.bookmarks[i].extent };
        if (b.layers && b.layers.length) {
          const vis = [];
          for (const r of b.layers) {
            if (!r.visible) continue;
            if (r.id === SKETCH_GRAPHICS_ID) vis.push(...sketchIds);
            else if (ids.has(r.id)) vis.push(r.id);
          }
          slide.visibleLayers = [...new Set(vis)].map((id) => ({ id }));
        }
        return slide;
      }) };
    }
  }
  return wm;
}

// ---------------------------------------------------------------- opening a web map (file or ArcGIS Online)

export function looksLikeWebMap(raw) {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && raw.type !== DOC_TYPE &&
    (Array.isArray(raw.operationalLayers) || (!!raw.baseMap && typeof raw.baseMap === "object"));
}
const HTTPS = /^https:\/\//i;
const TEMPLATE = /^\{[^{}]{1,200}\}$/;
const okUrl = (u) => typeof u === "string" && u.length < 4000 && HTTPS.test(u);
const okImage = (u) => typeof u === "string" && (okUrl(u) || TEMPLATE.test(u) || (DATA_IMAGE.test(u) && u.length < 3e6));
const SERVICE_KEYS = new Set(["url", "styleUrl", "templateUrl", "mapUrl", "itemUrl"]);
const LINK_KEYS = new Set(["sourceURL", "linkURL", "href", "imageUrl", "thumbnailUrl"]);
const LAYER_TYPES = new Set(["ArcGISAnnotationLayer", "CatalogLayer", "CSV", "ArcGISDimensionLayer", "ArcGISFeatureLayer", "GeoJSON", "GeoRSS", "GroupLayer",
  "ArcGISImageServiceLayer", "ArcGISImageServiceVectorLayer", "KML", "KnowledgeGraphLayer", "LinkChartLayer", "ArcGISMapServiceLayer", "Media", "OGCFeatureLayer",
  "OrientedImageryLayer", "ParquetLayer", "ArcGISStreamLayer", "SubtypeGroupLayer", "ArcGISTiledImageServiceLayer", "ArcGISTiledMapServiceLayer", "VectorTileLayer",
  "ArcGISVideoLayer", "WCS", "WebTiledLayer", "WFS", "WMS", "BingMapsAerial", "BingMapsRoad", "BingMapsHybrid", "OpenStreetMap"]);

// Copy JSON from a file, keeping only https web addresses (pictures may also be embedded or a {field}), replacing picture
// symbols that would load from elsewhere, and capping features. Returns undefined for a value that has to go.
function cleanJson(v, key, depth, budget, flags) {
  if (depth > 40) return undefined;
  if (typeof v === "string") {
    if (SERVICE_KEYS.has(key)) { if (okUrl(v)) return v; flags.badService = true; return undefined; }
    if (LINK_KEYS.has(key)) return okImage(v) ? v : undefined;
    return v.length > 200000 ? v.slice(0, 200000) : v;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) {
    const isFeatures = key === "features";
    const out = [];
    for (const x of v) {
      if (isFeatures) { if (budget.left <= 0) { flags.capped = true; break; } budget.left--; }
      const c = cleanJson(x, null, depth + 1, budget, flags);
      if (c !== undefined) out.push(c);
    }
    return out;
  }
  if (typeof v !== "object") return undefined;
  if ((v.type === "esriPMS" || v.type === "esriPFS" || v.type === "picture-marker" || v.type === "picture-fill") && !(okUrl(v.url) || (typeof v.imageData === "string" && v.imageData.length < 2e6)))
    return scrubSymbols(v, 0);
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const sub = { badService: false };
    const c = cleanJson(v[k], k, depth + 1, budget, sub);
    if (sub.badService) flags.badService = true;
    if (sub.capped) flags.capped = true;
    if (c !== undefined) out[k] = c;
  }
  return out;
}
// One operational layer from a file: known layer type, and every web address it loads from is https.
function cleanForeignLayer(op, budget, depth) {
  if (!op || typeof op !== "object" || depth > 6) return null;
  if (op.layers && op.layerType === "GroupLayer") {
    const layers = (Array.isArray(op.layers) ? op.layers : []).map((l) => cleanForeignLayer(l, budget, depth + 1)).filter(Boolean);
    if (!layers.length) return null;
    const { layers: _drop, ...rest } = op;
    const flags = {}; const g = cleanJson(rest, null, 0, budget, flags);
    return flags.badService ? null : { ...g, layers };
  }
  if (!LAYER_TYPES.has(op.layerType)) return null;
  if (op.itemId !== undefined && !HEX32.test(op.itemId || "")) return null;
  const flags = {};
  const c = cleanJson(op, null, 0, budget, flags);
  if (flags.badService) return null;
  if (!c.url && !c.styleUrl && !c.templateUrl && !c.itemId && !c.featureCollection) return null;
  if (typeof c.id !== "string" || !c.id) c.id = "layer" + Math.random().toString(36).slice(2, 9);
  else c.id = c.id.slice(0, 120);
  return c;
}
function cleanTargetGeometry(g) {
  if (!g || typeof g !== "object") return null;
  const sr = g.spatialReference && finite(g.spatialReference.wkid) ? { wkid: g.spatialReference.wkid } : SR;
  if (["xmin", "ymin", "xmax", "ymax"].every((k) => finite(g[k]))) return { xmin: g.xmin, ymin: g.ymin, xmax: g.xmax, ymax: g.ymax, spatialReference: sr };
  if (finite(g.x) && finite(g.y)) return { x: g.x, y: g.y, spatialReference: sr };
  return null;
}

/**
 * Read a web map (an .amap or .mmap file, any web map JSON, or an ArcGIS Online item's data).
 * Returns { ok:false, code } or { ok:true, webmap, graphics, layers, bookmarks, sketchVisible, skipped }:
 *  - webmap: JSON for the ArcGIS SDK without this app's own layers (and, from files, with every web address checked)
 *  - graphics / layers: this app's sketches and spreadsheet layers, rebuilt so they stay editable
 *  - bookmarks: with each one's layers on/off (from its presentation slide)
 */
export function readWebMap(raw, opts) {
  if (!looksLikeWebMap(raw)) return { ok: false, code: "notMapFile" };
  const trusted = !!(opts && opts.trusted);      // an ArcGIS Online item opened by id: its layers load from the item
  const budget = { left: MAX_FEATURES };
  let skipped = 0;
  const ops = Array.isArray(raw.operationalLayers) ? raw.operationalLayers : [];
  const own = ops.filter(isOwnLayerJson), foreignIn = ops.filter((o) => !isOwnLayerJson(o));
  const graphics = operationalLayersToSketch(own, budget);
  const layers = [];
  for (const op of own.filter((o) => o.id.startsWith(DATA_LAYER_PREFIX))) {
    const d = operationalLayerToDataDef(op, budget);
    if (d && d.features.length) layers.push(d); else skipped++;
  }
  const sketchOps = own.filter((o) => o.id.startsWith(SKETCH_LAYER_PREFIX));
  const sketchVisible = !sketchOps.length || sketchOps.some((o) => o.visibility !== false);
  const foreign = [];
  for (const op of foreignIn) {
    const c = trusted ? op : cleanForeignLayer(op, budget, 0);
    if (c) foreign.push(c); else skipped++;
  }
  let baseMap = null;
  if (raw.baseMap && typeof raw.baseMap === "object") {
    if (trusted) baseMap = raw.baseMap;
    else {
      const bl = (Array.isArray(raw.baseMap.baseMapLayers) ? raw.baseMap.baseMapLayers : []).map((l) => cleanForeignLayer(l, budget, 0)).filter(Boolean);
      if (bl.length) baseMap = { baseMapLayers: bl, title: str(raw.baseMap.title, 200) || "Basemap" };
    }
  }
  const webmap = { operationalLayers: foreign, version: str(raw.version, 10) || WEBMAP_SPEC_VERSION,
    spatialReference: raw.spatialReference && finite(raw.spatialReference.wkid) ? { wkid: raw.spatialReference.wkid, latestWkid: raw.spatialReference.latestWkid } : SR,
    authoringApp: str(raw.authoringApp, 100) || "unknown", authoringAppVersion: str(raw.authoringAppVersion, 40) || "" };
  if (baseMap) webmap.baseMap = baseMap;
  const vp = raw.initialState && raw.initialState.viewpoint;
  const tg = cleanTargetGeometry(vp && vp.targetGeometry);
  if (tg) {
    const viewpoint = { targetGeometry: tg };
    if (finite(vp.scale) && vp.scale > 0) viewpoint.scale = vp.scale;
    if (finite(vp.rotation)) viewpoint.rotation = clamp(vp.rotation, -360, 360, 0);
    webmap.initialState = { viewpoint };
  }
  // Bookmarks; maps saved by this app before 2.0 kept layers on/off in "atlasBookmarks".
  let bookmarks = Array.isArray(raw.atlasBookmarks) && raw.atlasBookmarks.length ? cleanBookmarks(raw.atlasBookmarks) : specToBookmarks(raw.bookmarks);
  const slides = raw.presentation && Array.isArray(raw.presentation.slides) ? raw.presentation.slides : [];
  if (!(Array.isArray(raw.atlasBookmarks) && raw.atlasBookmarks.length) && slides.length === (Array.isArray(raw.bookmarks) ? raw.bookmarks.length : -1)) {
    const opIds = foreign.map((o) => o.id).concat(layers.map((l) => DATA_LAYER_PREFIX + l.id));
    bookmarks = bookmarks.map((bm, i) => {
      const s = slides[i];
      if (!s || !Array.isArray(s.visibleLayers)) return bm;
      const on = new Set(s.visibleLayers.filter((v) => v && typeof v.id === "string").map((v) => v.id));
      const recs = opIds.map((id) => ({ id, title: "", visible: on.has(id) }));
      if (sketchOps.length) recs.push({ id: SKETCH_GRAPHICS_ID, title: "", visible: sketchOps.some((o) => on.has(o.id)) });
      return { ...bm, layers: recs };
    });
  }
  const totalIn = own.filter((o) => o.id.startsWith(DATA_LAYER_PREFIX)).reduce((n, o) => n + (((o.featureCollection || {}).layers || [])[0]?.featureSet?.features?.length || 0), 0);
  const totalOut = layers.reduce((n, l) => n + l.features.length, 0);
  if (totalIn > totalOut) skipped += totalIn - totalOut;
  return { ok: true, webmap, graphics, layers, bookmarks, sketchVisible, skipped };
}
