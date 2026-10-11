// CSV import: parse a spreadsheet saved as CSV and turn it into a point layer definition.
// Pure functions only (no ArcGIS SDK), so they can be unit-tested in Node.
// Nothing here sends the file anywhere: parsing happens in the browser.

export const CSV_VERSION = "3.0";   // 3.0: delimiter sniffing (, ; tab), decimal commas, quoted line breaks,
                                    // multi-language lat/long names, manual column choice

export const PALETTE_HEX = ["#0079c1", "#d4572a", "#1a7f37", "#8250df", "#b4453a", "#9a6700", "#e3116c", "#2b2b2b"];
export const PALETTE_RGB = [
  [0, 122, 194, 255], [255, 170, 0, 255], [76, 175, 80, 255], [216, 86, 48, 255],
  [142, 68, 173, 255], [0, 168, 168, 255], [233, 113, 184, 255], [121, 121, 121, 255]
];
export const COLOR_RAMPS = [
  { id: "blue", name: "Blues", colors: [[230, 241, 251], [199, 234, 255], [80, 167, 218], [0, 122, 194], [0, 97, 155]] },
  { id: "green", name: "Greens", colors: [[237, 248, 233], [186, 228, 179], [116, 196, 118], [49, 163, 84], [0, 109, 44]] },
  { id: "orange", name: "Oranges", colors: [[254, 237, 222], [253, 190, 133], [253, 141, 60], [230, 85, 13], [166, 54, 3]] },
  { id: "purple", name: "Purples", colors: [[242, 240, 247], [203, 201, 226], [158, 154, 200], [117, 107, 177], [84, 39, 143]] },
  { id: "red", name: "Reds", colors: [[254, 229, 217], [252, 174, 145], [251, 106, 74], [222, 45, 38], [165, 15, 21]] },
  { id: "bluered", name: "Blue–Red", colors: [[44, 123, 182], [171, 217, 233], [255, 255, 191], [253, 174, 97], [215, 25, 28]] }
];
export const DATA_STYLES = [
  { id: "simple", icon: "📍", requires: {}, fields: ["label"] },
  { id: "categorical", icon: "🏷️", requires: { minCategorical: 1 }, fields: ["color", "label"] },
  { id: "graduated", icon: "📏", requires: { minNumeric: 1 }, fields: ["size", "label"] },
  { id: "numeric_color_size", icon: "💠", requires: { minNumeric: 2 }, fields: ["color", "size", "label"] },
  { id: "categorical_size", icon: "🎨", requires: { minCategorical: 1, minNumeric: 1 }, fields: ["color", "size", "label"] },
  { id: "pie_chart", icon: "🥧", requires: { minNumeric: 3 }, fields: ["label"] }
];
export const SHAPES = [
  { id: "esriSMSCircle", glyph: "●" }, { id: "esriSMSSquare", glyph: "■" },
  { id: "esriSMSDiamond", glyph: "◆" }, { id: "esriSMSTriangle", glyph: "▲" }
];
const POINT_FILL_ALPHA = 204;

// Column names recognised as latitude / longitude (compared after lower-casing, removing accents,
// spaces, punctuation and anything in brackets). Several languages, for distributors outside the US.
const LAT_NAMES = ["latitude", "lat", "y", "latdd", "latitud", "latitudine", "breite", "breitengrad", "enlem",
  "breedtegraad", "szelesseg", "szelessegi", "latitudedd", "latdecimal"];
const LON_NAMES = ["longitude", "lon", "lng", "long", "x", "londd", "lngdd", "longitud", "longitudine", "lange",
  "laenge", "langengrad", "laengengrad", "boylam", "lengtegraad", "hosszusag", "longitudedd", "londecimal"];
export const COORD_KEYS = LAT_NAMES.concat(LON_NAMES);

export function normName(h) {
  return String(h == null ? "" : h)
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

const NUM_RE = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const DEC_COMMA_RE = /^[-+]?\d+,\d+$/;

/** Pick the delimiter (comma, semicolon or tab) that splits the first lines most consistently. */
export function sniffDelimiter(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").slice(0, 12);
  if (!lines.length) return ",";
  let best = ",", bestScore = -1;
  for (const d of [",", ";", "\t"]) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0];
    if (!first) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 100 + first;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
function countOutsideQuotes(line, d) {
  let n = 0, q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** Split CSV text into rows of cells. Handles quoted cells, "" escapes and line breaks inside quotes. */
export function parseRows(text, delim) {
  const s = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { q = true; continue; }
    if (ch === delim) { row.push(cell); cell = ""; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const isBlankRow = (r) => !r || r.every((c) => String(c == null ? "" : c).trim() === "");
const fail = (code, params) => ({ ok: false, code, params: params || {} });

/**
 * Read CSV text. Returns { ok, header, rows, delim, latIdx, lonIdx } or { ok:false, code, params }.
 * latIdx/lonIdx are -1 when no column name matched; the app then asks the user to choose.
 */
export function readCsv(text, maxRows) {
  maxRows = maxRows || 1000;
  const delim = sniffDelimiter(text);
  const all = parseRows(text, delim);
  while (all.length && isBlankRow(all[all.length - 1])) all.pop();
  if (!all.length) return fail("csvEmpty");
  if (isBlankRow(all[0])) return fail("csvA1");
  const header = all[0].map((h) => String(h == null ? "" : h).trim());
  if (header[0] === "") return fail("csvA1col");
  while (header.length && header[header.length - 1] === "") header.pop();
  for (let i = 0; i < header.length; i++) if (header[i] === "") return fail("csvNoHeading", { n: i + 1 });
  const rows = all.slice(1).filter((r) => !isBlankRow(r));
  if (!rows.length) return fail("csvNoRows");
  if (rows.length > maxRows) return fail("csvTooMany", { n: rows.length, max: maxRows });
  const found = detectLatLon(header);
  return { ok: true, header, rows, delim, latIdx: found.latIdx, lonIdx: found.lonIdx };
}

export function detectLatLon(header) {
  let latIdx = -1, lonIdx = -1;
  header.forEach((h, i) => {
    const n = normName(h);
    if (latIdx < 0 && LAT_NAMES.includes(n)) latIdx = i;
    else if (lonIdx < 0 && LON_NAMES.includes(n)) lonIdx = i;
  });
  return { latIdx, lonIdx };
}

/** Does this column use decimal commas (e.g. "51,5")? Only possible when the delimiter isn't a comma. */
export function usesDecimalComma(rows, idx, delim) {
  if (delim === ",") return false;
  let comma = 0, dot = 0;
  for (const r of rows) {
    const v = String(r[idx] == null ? "" : r[idx]).trim();
    if (DEC_COMMA_RE.test(v)) comma++; else if (/^[-+]?\d+\.\d+$/.test(v)) dot++;
  }
  return comma > 0 && comma >= dot;
}
export function toNumber(raw, decimalComma) {
  let v = String(raw == null ? "" : raw).trim();
  if (v === "") return null;
  if (decimalComma && DEC_COMMA_RE.test(v)) v = v.replace(",", ".");
  return NUM_RE.test(v) ? Number(v) : NaN;
}

export function sanitizeFieldName(h, used) {
  let n = String(h).trim().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]/g, "_").replace(/^_+|_+$/g, "");
  if (!n) n = "field";
  if (/^\d/.test(n)) n = "F" + n;
  if (n.length > 60) n = n.slice(0, 60);
  const base = n; let k = 2;
  while (used[n.toLowerCase()]) { n = base + "_" + k; k++; }
  used[n.toLowerCase()] = true;
  return n;
}

export function lonLatToWebMercator(lon, lat) {
  const R = 20037508.342788905;
  const la = Math.max(-89.9999, Math.min(89.9999, lat));
  return [lon / 180 * R, Math.log(Math.tan((90 + la) * Math.PI / 360)) / Math.PI * R];
}

/**
 * Turn parsed rows into features + fields. Column types are inferred: a column is numeric when every
 * non-empty cell is a number (decimal commas allowed when the file uses them).
 */
export function buildLayerData(fileName, parsed, latIdx, lonIdx) {
  const { header, rows, delim } = parsed;
  const decComma = header.map((_, i) => usesDecimalComma(rows, i, delim));
  const used = { objectid: true };
  const names = header.map((h) => sanitizeFieldName(h, used));
  const isNum = header.map(() => true), isInt = header.map(() => true), hasVal = header.map(() => false);
  for (const cells of rows) {
    for (let i = 0; i < header.length; i++) {
      const raw = cells[i];
      const n = toNumber(raw, decComma[i]);
      if (n === null) continue;
      hasVal[i] = true;
      if (Number.isNaN(n)) { isNum[i] = false; isInt[i] = false; }
      else if (!Number.isInteger(n) || /[.,eE]/.test(String(raw))) isInt[i] = false;
    }
  }
  const fields = [{ name: "ObjectId", alias: "ObjectId", type: "esriFieldTypeOID" }];
  header.forEach((h, i) => {
    const type = hasVal[i] && isNum[i] ? (isInt[i] ? "esriFieldTypeInteger" : "esriFieldTypeDouble") : "esriFieldTypeString";
    const f = { name: names[i], alias: h, type };
    if (type === "esriFieldTypeString") f.length = 2048;
    fields.push(f);
  });
  const features = []; let dropped = 0;
  for (const cells of rows) {
    const lat = toNumber(cells[latIdx], decComma[latIdx]);
    const lon = toNumber(cells[lonIdx], decComma[lonIdx]);
    if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { dropped++; continue; }
    const attrs = { ObjectId: features.length + 1 };
    header.forEach((_, c) => {
      const fd = fields[c + 1];
      const raw = String(cells[c] == null ? "" : cells[c]).trim();
      if (raw === "") attrs[names[c]] = null;
      else if (fd.type === "esriFieldTypeString") attrs[names[c]] = raw.slice(0, 2048);
      else attrs[names[c]] = toNumber(raw, decComma[c]);
    });
    const xy = lonLatToWebMercator(lon, lat);
    features.push({ geometry: { x: xy[0], y: xy[1], spatialReference: { wkid: 102100, latestWkid: 3857 } }, attributes: attrs });
  }
  if (!features.length) return fail("csvNoCoords");
  const coordNames = [names[latIdx], names[lonIdx]];
  const numeric = [], categorical = [];
  for (const f of fields) {
    if (f.type === "esriFieldTypeOID" || coordNames.includes(f.name)) continue;
    if (f.type !== "esriFieldTypeString") { numeric.push(f.name); continue; }
    const seen = new Set();
    for (const ft of features) {
      const v = ft.attributes[f.name];
      if (v !== null && v !== "") seen.add(v);
      if (seen.size > 12) break;
    }
    if (seen.size >= 2 && seen.size <= 12) categorical.push(f.name);
  }
  return { ok: true, fileName, features, fields, numeric, categorical, dropped, coordNames };
}

// ---------- Styling (renderers in ArcGIS REST JSON, so the same definition saves to .mmap and to a web map) ----------

export function styleAvailable(style, st) {
  const q = style.requires;
  if (q.minNumeric && st.numeric.length < q.minNumeric) return false;
  if (q.minCategorical && st.categorical.length < q.minCategorical) return false;
  return true;
}
export function pickAutoStyle(st) {
  for (const id of ["categorical_size", "categorical", "graduated", "simple"]) {
    const s = DATA_STYLES.find((x) => x.id === id);
    if (s && styleAvailable(s, st)) return s;
  }
  return DATA_STYLES[0];
}
export function pickAutoFields(style, st) {
  const choices = { color: null, size: null, label: null };
  if (style.id === "numeric_color_size") {
    choices.color = st.numeric[0] || null;
    choices.size = st.numeric[1] || st.numeric[0] || null;
  } else {
    if (style.fields.includes("color")) choices.color = st.categorical[0] || null;
    if (style.fields.includes("size")) choices.size = st.numeric[0] || null;
  }
  return choices;   // labels are opt-in
}
function dataSymbol(st, color, size) {
  const sym = st.symbolChoices, base = color || sym.color;
  return { type: "esriSMS", style: sym.shape || "esriSMSCircle", color: [base[0], base[1], base[2], POINT_FILL_ALPHA],
    size: size || sym.size, outline: { color: [80, 80, 80, 255], width: 1 } };
}
function finiteValues(features, field) {
  return features.map((f) => f.attributes[field]).filter((v) => typeof v === "number" && Number.isFinite(v));
}
function sizeVariable(st, field) {
  const values = finiteValues(st.features, field);
  if (!values.length) return null;
  const s = st.symbolChoices.size || 12;
  return { type: "sizeInfo", field, minSize: Math.max(4, Math.round(s * 0.7)), maxSize: Math.round(s * 3.3),
    minDataValue: Math.min(...values), maxDataValue: Math.max(...values) };
}
function pieRenderer(st) {
  const fieldsUsed = st.numeric.slice(0, 8);
  const totals = st.features.map((f) => {
    let sum = 0;
    for (const fld of fieldsUsed) { const v = f.attributes[fld]; if (typeof v === "number" && Number.isFinite(v)) sum += v; }
    f.attributes._pieTotal = sum;
    return sum;
  });
  const s = st.symbolChoices.size || 12;
  return {
    type: "pieChart",
    attributes: fieldsUsed.map((fld, i) => ({ field: fld, color: PALETTE_RGB[i % PALETTE_RGB.length], label: aliasOf(st, fld) })),
    size: s * 2, holePercentage: 0.4,
    outline: { type: "esriSLS", style: "esriSLSSolid", color: [255, 255, 255, 255], width: 0.5 },
    visualVariables: [{ type: "sizeInfo", field: "_pieTotal", minSize: Math.round(14 * s / 12), maxSize: Math.round(48 * s / 12),
      minDataValue: Math.min(...totals), maxDataValue: Math.max(...totals) }]
  };
}
function numericColorRenderer(st, field) {
  const values = finiteValues(st.features, field);
  if (!values.length) return { type: "simple", symbol: dataSymbol(st) };
  const min = Math.min(...values), max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / values.length);
  let lo = Math.max(min, mean - sd), hi = Math.min(max, mean + sd);
  if (lo >= hi) { lo = min; hi = max; }
  if (lo >= hi) hi = lo + 1;
  const ramp = (COLOR_RAMPS.find((r) => r.id === st.symbolChoices.ramp) || COLOR_RAMPS[0]).colors, n = ramp.length;
  const r2 = (x) => Math.round(x * 100) / 100;
  const stops = ramp.map((c, i) => ({ value: r2(lo + (hi - lo) * i / (n - 1)), color: [c[0], c[1], c[2], POINT_FILL_ALPHA],
    label: i === 0 ? "< " + r2(lo) : (i === n - 1 ? "> " + r2(hi) : "") }));
  return { type: "simple", symbol: dataSymbol(st), visualVariables: [{ type: "colorInfo", field, stops }] };
}
function uniqueRenderer(st, field) {
  const values = [...new Set(st.features.map((f) => f.attributes[field]).filter((v) => v !== null && v !== undefined && v !== ""))].sort();
  return { type: "uniqueValue", field1: field, defaultSymbol: dataSymbol(st, [179, 179, 179, 200]), defaultLabel: "Other",
    uniqueValueInfos: values.map((val, i) => ({ value: String(val), label: String(val), symbol: dataSymbol(st, PALETTE_RGB[i % PALETTE_RGB.length]) })) };
}
export function aliasOf(st, name) {
  const f = (st.fields || []).find((x) => x.name === name);
  return (f && f.alias) || String(name).replace(/_/g, " ");
}
export function buildRenderer(st) {
  const style = st.style, c = st.fieldChoices;
  const colorIsNumeric = c.color && st.numeric.includes(c.color);
  const colorRenderer = (f) => (colorIsNumeric ? numericColorRenderer(st, f) : uniqueRenderer(st, f));
  const withSize = (r, f) => { const sv = sizeVariable(st, f); if (sv) r.visualVariables = (r.visualVariables || []).concat([sv]); return r; };
  switch (style.id) {
    case "pie_chart": return pieRenderer(st);
    case "numeric_color_size": return withSize(numericColorRenderer(st, c.color), c.size);
    case "categorical_size": return withSize(colorRenderer(c.color), c.size);
    case "categorical": return colorRenderer(c.color);
    case "graduated": return withSize({ type: "simple", symbol: dataSymbol(st), label: aliasOf(st, c.size) }, c.size);
    default: return { type: "simple", symbol: dataSymbol(st) };
  }
}
export function buildLabelingInfo(labelField) {
  if (!labelField) return null;
  return [{
    labelExpression: "[" + labelField + "]", labelExpressionInfo: { expression: "$feature." + labelField },
    labelPlacement: "esriServerPointLabelPlacementAboveCenter", useCodedValues: true,
    symbol: { type: "esriTS", color: [50, 50, 50, 255], haloColor: [255, 255, 255, 255], haloSize: 1.5, font: { family: "Arial", size: 10, weight: "bold" } },
    minScale: 0, maxScale: 0
  }];
}
function popupTitle(st) {
  const c = st.fieldChoices;
  switch (st.style.id) {
    case "numeric_color_size": case "categorical_size": return "{" + c.color + "} – {" + c.size + "}";
    case "categorical": return "{" + c.color + "}";
    case "graduated": return "{" + c.size + "}";
    default: {
      const firstText = st.fields.find((f) => f.type === "esriFieldTypeString" && !st.coordNames.includes(f.name));
      return firstText ? "{" + firstText.name + "}" : "";
    }
  }
}

/** The saved layer definition: a v3 feature collection (fields, REST renderer, labels, pop-up, features). */
export function buildLayerDef(st, id, title) {
  const renderer = buildRenderer(st);
  let fields = st.fields.slice();
  if (st.style.id === "pie_chart" && !fields.some((f) => f.name === "_pieTotal")) fields = fields.concat([{ name: "_pieTotal", alias: "Total", type: "esriFieldTypeDouble" }]);
  const fieldInfos = st.fields
    .filter((f) => f.type !== "esriFieldTypeOID" && !st.coordNames.includes(f.name))
    .map((f) => ({ fieldName: f.name, label: f.alias || f.name, visible: true }));
  return {
    id, title: title || String(st.fileName || "My data").replace(/\.(csv|txt)$/i, "").replace(/_+/g, " ").trim() || "My data",
    geometryType: "point", objectIdField: "ObjectId", spatialReference: { wkid: 102100, latestWkid: 3857 },
    fields, renderer, labelingInfo: buildLabelingInfo(st.fieldChoices.label),
    popupInfo: { title: popupTitle(st), content: [{ type: "fields", fieldInfos }], fieldInfos },
    features: st.features
  };
}
