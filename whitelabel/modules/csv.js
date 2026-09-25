// CSV to map layer. Ported from the Atlas local-save concept (v2.8) so the same files and checks behave the same.
export const CSV_VERSION = "1.0";
const MAX_ROWS = 5000;
const LAT_NAMES = ["latitude", "lat", "y", "latitud", "breitengrad", "latitudine"];
const LON_NAMES = ["longitude", "lon", "long", "lng", "x", "longitud", "längengrad", "longitudine"];
const NUM_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
export const PALETTE = ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#1f78b4", "#b2df8a", "#fb9a99", "#cab2d6", "#666666"];

function splitCsvLine(line, sep) {
  const cells = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === sep && !q) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur); return cells;
}
const fail = (error) => ({ ok: false, error });

export function readCsv(text, s) {
  const lines = String(text).replace(/^﻿/, "").split(/\r\n|\n|\r/);
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (!lines.length) return fail(s.csvEmpty);
  // comma, or semicolon for spreadsheets saved in countries that use a decimal comma
  const sep = (lines[0].split(";").length > lines[0].split(",").length) ? ";" : ",";
  const blank = (l) => l.split(sep).join("").trim() === "";
  if (blank(lines[0])) return fail(s.csvA1);
  const header = splitCsvLine(lines[0], sep).map((h) => String(h ?? ""));
  if (header[0].trim() === "") return fail(s.csvA1col);
  while (header.length && header[header.length - 1].trim() === "") header.pop();
  for (let i = 0; i < header.length; i++) if (header[i].trim() === "") return fail(s.csvNoHeading.replace("{n}", i + 1));
  const rows = [];
  for (let r = 1; r < lines.length; r++) if (!blank(lines[r])) rows.push(splitCsvLine(lines[r], sep));
  if (!rows.length) return fail(s.csvNoRows);
  if (rows.length > MAX_ROWS) return fail(s.csvTooMany.replace("{n}", rows.length).replace("{max}", MAX_ROWS));
  let latIdx = -1, lonIdx = -1;
  header.forEach((h, i) => { const n = h.trim().toLowerCase();
    if (latIdx < 0 && LAT_NAMES.includes(n)) latIdx = i; if (lonIdx < 0 && LON_NAMES.includes(n)) lonIdx = i; });
  if (latIdx < 0 || lonIdx < 0) return fail(s.csvNoLatLon);
  return { ok: true, header, rows, latIdx, lonIdx, decimalComma: sep === ";" };
}

function sanitizeFieldName(h, used) {
  let n = String(h).trim().replace(/[^\w]/g, "_").replace(/^_+|_+$/g, "") || "field";
  if (/^\d/.test(n)) n = "F" + n;
  const base = n; let k = 2; while (used[n]) n = base + "_" + k++;
  used[n] = true; return n;
}
function toMerc(lon, lat) {
  const R = 20037508.342788905, la = Math.max(-89.9999, Math.min(89.9999, lat));
  return [lon / 180 * R, Math.log(Math.tan((90 + la) * Math.PI / 360)) / Math.PI * R];
}

// Returns a layer definition in the same shape the Atlas concept saves (fields, features, renderer, popupInfo).
export function buildCsvLayerDef(fileName, p, s) {
  const num = (v) => p.decimalComma ? String(v).replace(",", ".") : String(v);
  const used = { ObjectId: true }, names = p.header.map((h) => sanitizeFieldName(h, used));
  const isNum = p.header.map(() => true), isInt = p.header.map(() => true), hasVal = p.header.map(() => false);
  for (const cells of p.rows) for (let i = 0; i < p.header.length; i++) {
    const v = num(cells[i] ?? "").trim(); if (v === "") continue; hasVal[i] = true;
    if (!NUM_RE.test(v)) { isNum[i] = false; isInt[i] = false; } else if (v.includes(".") || /[eE]/.test(v)) isInt[i] = false;
  }
  const fields = [{ name: "ObjectId", alias: "ObjectId", type: "esriFieldTypeOID" }];
  p.header.forEach((h, i) => fields.push({ name: names[i], alias: h.trim(),
    type: (hasVal[i] && isNum[i]) ? (isInt[i] ? "esriFieldTypeInteger" : "esriFieldTypeDouble") : "esriFieldTypeString" }));
  const features = []; let dropped = 0;
  for (const cells of p.rows) {
    const lat = parseFloat(num(cells[p.latIdx] ?? "").trim()), lon = parseFloat(num(cells[p.lonIdx] ?? "").trim());
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { dropped++; continue; }
    const attributes = { ObjectId: features.length + 1 };
    p.header.forEach((_, c) => { const raw = num(cells[c] ?? "").trim(), fd = fields[c + 1];
      attributes[names[c]] = raw === "" ? null : (fd.type !== "esriFieldTypeString" ? Number(raw) : String(cells[c]).trim()); });
    const [x, y] = toMerc(lon, lat);
    features.push({ geometry: { x, y, spatialReference: { wkid: 102100, latestWkid: 3857 } }, attributes });
  }
  if (!features.length) return fail(s.csvNoCoords);
  const coord = [p.header[p.latIdx], p.header[p.lonIdx]].map((h) => h.trim().toLowerCase());
  const numeric = [], categorical = [];
  fields.forEach((f) => {
    if (f.type === "esriFieldTypeOID" || coord.includes(f.alias.toLowerCase())) return;
    if (f.type !== "esriFieldTypeString") { numeric.push(f.name); return; }
    const seen = new Set(); for (const ft of features) { const v = ft.attributes[f.name]; if (v != null && v !== "") seen.add(v); if (seen.size > 12) break; }
    if (seen.size >= 2 && seen.size <= 12) categorical.push(f.name);
  });
  const titleField = fields.find((f) => f.type === "esriFieldTypeString" && !coord.includes(f.alias.toLowerCase()));
  const def = {
    title: fileName.replace(/\.csv$/i, ""), source: "csv", geometryType: "point", objectIdField: "ObjectId",
    spatialReference: { wkid: 102100 }, fields, features,
    renderer: simpleRenderer(PALETTE[0]),
    popupInfo: { title: titleField ? `{${titleField.name}}` : fileName,
      content: [{ type: "fields", fieldInfos: fields.filter((f) => f.type !== "esriFieldTypeOID").map((f) => ({ fieldName: f.name, label: f.alias })) }] }
  };
  return { ok: true, def, numeric, categorical, dropped };
}

const marker = (color) => ({ type: "simple-marker", size: 9, color, outline: { color: [255, 255, 255, 0.9], width: 1 } });
export function simpleRenderer(color) { return { type: "simple", symbol: marker(color) }; }

// Style by a field: a colour per category, or a colour ramp for numbers.
export function rendererFor(def, field, numeric) {
  if (!field) return simpleRenderer(PALETTE[0]);
  if (numeric.includes(field)) {
    const vals = def.features.map((f) => f.attributes[field]).filter((v) => typeof v === "number" && isFinite(v));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return { type: "simple", symbol: marker("#888"), visualVariables: [{ type: "color", field,
      stops: [{ value: lo, color: "#fef0d9", label: String(lo) }, { value: (lo + hi) / 2, color: "#fc8d59" }, { value: hi, color: "#b30000", label: String(hi) }] }] };
  }
  const values = [...new Set(def.features.map((f) => f.attributes[field]).filter((v) => v != null && v !== ""))];
  return { type: "unique-value", field, defaultSymbol: marker("#999"), defaultLabel: "Other",
    uniqueValueInfos: values.map((v, i) => ({ value: v, label: String(v), symbol: marker(PALETTE[i % PALETTE.length]) })) };
}
