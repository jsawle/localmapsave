// Add a spreadsheet (CSV) to a map as a client-side layer. The file is read in the browser: nothing is uploaded and
// no account is needed. Works with ArcGIS Maps SDK for JavaScript 4.x and 5.x: pass the SDK classes in, so it runs the
// same with the CDN ($arcgis.import) or npm (@arcgis/core).
// Part of the Atlas local save and add data kit. Created by Jason Sawle.
import { CSV_VERSION, DATA_STYLES, COLOR_RAMPS, SHAPES, PALETTE_RGB, readCsv, buildLayerData, styleAvailable, pickAutoStyle, pickAutoFields,
  buildLayerDef } from "../lib/csv.js";

export { CSV_VERSION, DATA_STYLES, COLOR_RAMPS, SHAPES };
export const DATA_LAYER_PREFIX = "__data_";   // the layer id, and its operational layer id when saved

/**
 * Read the text of a CSV file.
 * Returns one of:
 *   { ok: true, features, fields, numeric, categorical, dropped, coordNames, fileName }
 *        numeric / categorical: column names that can drive size / colour; dropped: rows without usable coordinates
 *   { ok: false, needsColumns: true, header, latIdx, lonIdx }
 *        latitude/longitude columns weren't recognised: ask which columns hold them, then call again with
 *        options.latIdx and options.lonIdx (column indexes)
 *   { ok: false, code, params }
 *        a problem with the file. code is one of csvEmpty, csvA1, csvA1col, csvNoHeading, csvNoRows, csvTooMany, csvNoCoords
 *        (lib/strings.js in the app has the wording for each)
 * options: { maxRows (default 1000), latIdx, lonIdx }
 */
export function readCsvData(text, fileName, options) {
  const o = options || {};
  const parsed = readCsv(text, o.maxRows || 1000);
  if (!parsed.ok) return parsed;
  const latIdx = Number.isInteger(o.latIdx) ? o.latIdx : parsed.latIdx;
  const lonIdx = Number.isInteger(o.lonIdx) ? o.lonIdx : parsed.lonIdx;
  if (latIdx < 0 || lonIdx < 0 || latIdx === lonIdx) return { ok: false, needsColumns: true, header: parsed.header, latIdx: parsed.latIdx, lonIdx: parsed.lonIdx };
  return buildLayerData(fileName, parsed, latIdx, lonIdx);
}

/** The map styles these columns allow (DATA_STYLES entries: simple, categorical, graduated, numeric_color_size, categorical_size, pie_chart). */
export function availableStyles(data) { return DATA_STYLES.filter((s) => styleAvailable(s, data)); }

/**
 * Turn read data into a layer definition: fields, an ArcGIS REST renderer, labels, a pop-up and the features
 * (a feature collection, so the same definition draws now and saves into a web map).
 * options (all optional; anything left out is chosen from the columns):
 *   id, title
 *   style      "simple" | "categorical" | "graduated" | "numeric_color_size" | "categorical_size" | "pie_chart"
 *   color      column that sets the colour (a category column, or a number column for a colour ramp)
 *   size       number column that sets the size
 *   label      column to label points with (labels are off unless given)
 *   shape      "esriSMSCircle" | "esriSMSSquare" | "esriSMSDiamond" | "esriSMSTriangle"
 *   colorRgb   [r, g, b] for single-colour points;  pointSize  in px (default 12);  ramp  a COLOR_RAMPS id (default "blue")
 */
export function layerDefFromData(data, options) {
  const o = options || {};
  const st = { ...data, features: data.features.map((f) => ({ geometry: f.geometry, attributes: { ...f.attributes } })),
    symbolChoices: { shape: o.shape || "esriSMSCircle", color: o.colorRgb || PALETTE_RGB[0], size: o.pointSize || 12, ramp: o.ramp || "blue" } };
  const style = o.style ? DATA_STYLES.find((s) => s.id === o.style) : pickAutoStyle(st);
  if (!style || !styleAvailable(style, st)) throw new Error("This style needs columns the data doesn't have: " + o.style);
  st.style = style;
  const auto = pickAutoFields(style, st);
  st.fieldChoices = { color: o.color !== undefined ? o.color : auto.color, size: o.size !== undefined ? o.size : auto.size, label: o.label || null };
  return buildLayerDef(st, o.id || "csv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), o.title);
}

/**
 * A layer definition (from layerDefFromData, or read back from a saved web map) as a client-side FeatureLayer.
 * sdk: { FeatureLayer, Graphic, Field, LabelClass, rendererJsonUtils }
 * The layer keeps its definition (dataLayerDef) so it can be saved again.
 */
export function createDataLayer(def, sdk) {
  const { FeatureLayer, Graphic, Field, LabelClass, rendererJsonUtils } = sdk;
  const gtype = def.geometryType || "point";
  const rawFields = (def.fields || []).slice();
  let oidField = def.objectIdField;
  if (!oidField) { const o = rawFields.find((f) => f.type === "esriFieldTypeOID" || f.type === "oid"); oidField = o ? o.name : "__oid"; }
  if (!rawFields.some((f) => f.name === oidField)) rawFields.unshift({ name: oidField, alias: oidField, type: "esriFieldTypeOID" });
  const fields = rawFields.map((f) => (typeof f.type === "string" && f.type.indexOf("esriFieldType") === 0 ? Field.fromJSON(f) : f));
  const source = (def.features || []).map((f, i) => {
    let g = f.geometry || null;
    if (g && !g.type) g = { ...g, type: gtype };
    const attributes = { ...(f.attributes || {}) };
    if (attributes[oidField] == null) attributes[oidField] = i + 1;
    return new Graphic({ geometry: g, attributes });
  });
  const props = { source, objectIdField: oidField, fields, geometryType: gtype, spatialReference: def.spatialReference || { wkid: 102100 },
    title: def.title || "Data", popupEnabled: true };
  if (def.id) props.id = DATA_LAYER_PREFIX + def.id;
  if (def.renderer) props.renderer = def.renderer.type && def.renderer.type.indexOf("-") >= 0 ? def.renderer : rendererJsonUtils.fromJSON(def.renderer);
  if (def.labelingInfo && def.labelingInfo.length) props.labelingInfo = def.labelingInfo.map((l) => (l && l.symbol && l.symbol.type === "esriTS" ? LabelClass.fromJSON(l) : l));
  if (def.popupInfo) props.popupTemplate = { title: def.popupInfo.title || "", content: def.popupInfo.content || [{ type: "fields", fieldInfos: def.popupInfo.fieldInfos || [] }], fieldInfos: def.popupInfo.fieldInfos || [] };
  const layer = new FeatureLayer(props);
  layer.labelsVisible = true;
  if (def.visible === false) layer.visible = false;
  if (typeof def.opacity === "number") layer.opacity = def.opacity;
  const keep = { ...def }; delete keep.visible; delete keep.opacity;
  layer.atlasDataDef = keep;
  return layer;
}

/** The definition behind a layer made by createDataLayer, with its current visibility and transparency (for saving). */
export function dataLayerDef(layer) {
  return layer && layer.atlasDataDef ? { ...layer.atlasDataDef, visible: layer.visible !== false, opacity: layer.opacity } : null;
}
