// CSV import: parse a spreadsheet saved as CSV and turn it into a point layer definition.
// Pure functions only (no ArcGIS SDK), so they can be unit-tested in Node.
// Nothing here sends the file anywhere: parsing happens in the browser.

export const CSV_VERSION = "3.4";   // 3.0: delimiter sniffing (, ; tab), decimal commas, quoted line breaks,
                                    // multi-language lat/long names, manual column choice
                                    // 3.1: a layer's style can be changed after it's added (stateFromLayerDef)
                                    // 3.2: coordinates with N/S/E/W and degrees-minutes-seconds; whole-number codes
                                    //      (2-12 values) can be types; pie charts from chosen columns
                                    // 3.3: "By type" uses text columns only again: whole numbers are always amounts
                                    //      (a litter survey's counts looked like codes in a small file)
                                    // 3.4: one column holding both coordinates, as copied from the map's Coordinates
                                    //      tool (XY, DD, DDM, DMS, UTM, MGRS/USNG, basemap metres), in any app language

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

/** Split CSV text into rows of cells. Handles quoted cells, "" escapes, line breaks inside quotes, and stray quotes mid-cell. */
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
    if (ch === '"' && cell === "") { q = true; continue; }   // a quote starts quoting only at the start of a cell;
                                                            // elsewhere it's text (51°08'46"N typed by hand)
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
 * Read CSV text. Returns { ok, header, rows, delim, dirTable, latIdx, lonIdx } or { ok:false, code, params }.
 * latIdx/lonIdx are -1 when no column name matched; the app then asks the user to choose. When one column holds both
 * coordinates (see parseCoordPair), latIdx and lonIdx are both that column. dirs: the app language's hemisphere letters
 * ({ north, south, east, west }, from the SDK); English is used when left out.
 */
export function readCsv(text, maxRows, dirs) {
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
  const dirTable = directionTable(dirs);
  const found = detectLatLon(header);
  if (found.latIdx < 0 || found.lonIdx < 0) {   // no latitude and longitude columns: is there one column with both?
    const pair = detectPairColumn(header, rows, dirTable);
    if (pair >= 0) return { ok: true, header, rows, delim, dirTable, latIdx: pair, lonIdx: pair };
  }
  return { ok: true, header, rows, delim, dirTable, latIdx: found.latIdx, lonIdx: found.lonIdx };
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

// ---------------------------------------------------------------- coordinates
// Hemisphere letters. The map's Coordinates tool (Esri's Coordinate Conversion widget) writes them in the app's language
// (Spanish O = west, German O = east, Finnish E = south, Hungarian Ny = west...), so the app passes in the SDK's own
// letters for its language. English N/S/E/W are also read, unless the language uses that letter for something else.
export const ENGLISH_DIRS = { north: "N", south: "S", east: "E", west: "W" };
export function directionTable(dirs) {
  const t = {};
  const add = (d, overwrite) => {
    for (const [k, axis, sign] of [["north", "lat", 1], ["south", "lat", -1], ["east", "lon", 1], ["west", "lon", -1]]) {
      const l = String((d && d[k]) || "").trim().toUpperCase();
      if (l && (overwrite || !(l in t))) t[l] = { axis, sign };
    }
  };
  add(dirs, true); add(ENGLISH_DIRS, false);
  return t;
}
const ENGLISH_TABLE = directionTable(null);

// Text as copied from the Coordinates tool carries invisible direction marks after each degree sign. A CSV saved by
// Excel in an older encoding turns the degree sign into a broken character and the mark into "?". Both are tidied here.
export function cleanCoordText(raw) {
  return String(raw == null ? "" : raw)
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/�/g, "°").replace(/\?/g, "")
    .replace(/[   ]/g, " ")
    .trim();
}

// One latitude or longitude. Returns null (empty), NaN (unreadable) or { value, axis, deg }: axis is "lat" or "lon"
// when a hemisphere letter says so (null otherwise); deg is true when it was written with a degree sign.
function coordPart(raw, decimalComma, table) {
  const text = cleanCoordText(raw);
  if (text === "") return null;
  const plain = toNumber(text, decimalComma);
  if (!Number.isNaN(plain)) return { value: plain, axis: null, deg: false };
  let v = text.toUpperCase().replace(/[′’‘`´]/g, "'").replace(/[″”“]/g, '"').replace(/[º˚]/g, "°");
  const deg = v.includes("°");
  let hemi = null;
  const lead = v.match(/^(\p{L}+)\.?\s*(.+)$/u), tail = v.match(/^(.+?)\s*(\p{L}+)\.?$/u);
  if (lead && table[lead[1]]) { hemi = table[lead[1]]; v = lead[2]; }
  else if (tail && table[tail[2]]) { hemi = table[tail[2]]; v = tail[1]; }
  else if (lead || tail) return NaN;   // letters this language doesn't use for a direction
  if (decimalComma || /\d,\d/.test(v)) v = v.replace(/(\d),(\d)/g, "$1.$2");
  const parts = v.replace(/[°'"]/g, " ").trim().split(/[\s:]+/).filter(Boolean);
  if (!parts.length || parts.length > 3 || !parts.every((x) => /^[-+]?\d+(\.\d+)?$/.test(x))) return NaN;
  if (!hemi && !deg && parts.length === 1) return NaN;   // a plain number would have been read above
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n < 0 || n > 60)) return NaN;   // 60 itself: the Coordinates tool rounds 59.6' up to "60'"
  if (parts.length > 1 && !Number.isInteger(nums[0])) return NaN;
  if (nums.slice(0, -1).some((n, i) => i > 0 && !Number.isInteger(n))) return NaN;   // only the last part may have decimals
  let d = nums[0], sign = hemi ? hemi.sign : 1;
  if (d < 0 || Object.is(d, -0) || /^-/.test(parts[0])) { if (hemi) return NaN; sign = -1; d = Math.abs(d); }
  return { value: sign * (d + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600), axis: hemi ? hemi.axis : null, deg };
}

// A latitude or longitude: decimal degrees ("51.5", "-0.12"), with a hemisphere letter ("51.5N", "0.12W", "N51.5"),
// or degrees, minutes and seconds ("51°30'15\"N", "51 30 15 N", "51:30:15"). The letter must suit the column (N or S
// for latitude, E or W for longitude); a minus sign and a letter together are refused as unclear. null = empty cell,
// NaN = not readable. Range checks are left to the caller. table: from directionTable (English letters if left out).
export function parseCoord(raw, decimalComma, axis, table) {
  const p = coordPart(raw, decimalComma, table || ENGLISH_TABLE);
  if (p === null || Number.isNaN(p)) return p;
  if (p.axis && axis && p.axis !== axis) return NaN;
  return p.value;
}

// ---------------------------------------------------------------- one column holding both coordinates
const A_WGS84 = 6378137, F_WGS84 = 1 / 298.257223563, K0 = 0.9996, R_MERC = 6378137;
/** UTM easting/northing (metres) -> [lon, lat], WGS84. Krüger series; well under a metre of error. */
export function utmToLonLat(zone, north, easting, northing) {
  const n = F_WGS84 / (2 - F_WGS84), A = A_WGS84 / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
  const beta = [n / 2 - 2 * n * n / 3 + 37 * n ** 3 / 96, n * n / 48 + n ** 3 / 15, 17 * n ** 3 / 480];
  const delta = [2 * n - 2 * n * n / 3 - 2 * n ** 3, 7 * n * n / 3 - 8 * n ** 3 / 5, 56 * n ** 3 / 15];
  const xi = (north ? northing : northing - 10000000) / (K0 * A), eta = (easting - 500000) / (K0 * A);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 3; j++) { xi1 -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); eta1 -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
  const lon0 = (zone - 1) * 6 - 180 + 3;
  let lon = lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1)) * 180 / Math.PI;
  if (lon > 180) lon -= 360; else if (lon < -180) lon += 360;
  return [lon, phi * 180 / Math.PI];
}
// MGRS / USNG 100 km squares (the WGS84 "AA" lettering): column letters repeat every 3 zones, row letters every
// 2,000 km, offset by 5 in even zones. The latitude band says which 2,000 km block the row is in.
const MGRS_COLS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"], MGRS_ROWS = "ABCDEFGHJKLMNPQRSTUV";
const BAND_MIN_N = { C: 1100000, D: 2000000, E: 2800000, F: 3700000, G: 4600000, H: 5500000, J: 6400000, K: 7300000, L: 8200000,
  M: 9100000, N: 0, P: 800000, Q: 1700000, R: 2600000, S: 3500000, T: 4400000, U: 5300000, V: 6200000, W: 7000000, X: 7900000 };
export function mgrsToLonLat(zone, band, colL, rowL, eDigits, nDigits) {
  const ci = MGRS_COLS[(zone - 1) % 3].indexOf(colL);
  let ri = MGRS_ROWS.indexOf(rowL);
  if (ci < 0 || ri < 0 || eDigits.length !== nDigits.length || eDigits.length < 1 || eDigits.length > 5) return null;
  if (zone % 2 === 0) ri = (ri - 5 + 20) % 20;
  const unit = 10 ** (5 - eDigits.length);
  const easting = (ci + 1) * 100000 + Number(eDigits) * unit;
  let northing = ri * 100000 + Number(nDigits) * unit;
  while (northing < BAND_MIN_N[band]) northing += 2000000;
  return utmToLonLat(zone, band >= "N", easting, northing);
}
export function webMercatorToLonLat(x, y) {
  return [x / R_MERC * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) * 180 / Math.PI];
}
const MERC_MAX = 20037508.35;

/**
 * Both coordinates in one cell, as the Coordinates tool copies them (and as people type them):
 *   XY "-0.12780°, 51.50740°" (longitude first) · DD "51.50740°N, 000.12780°W" · DDM "51° 30.444'N, 000° 07.668'W"
 *   DMS "51° 30' 26.64\"N, 000° 07' 40.08\"W" · UTM "30U 699316 5710163" · MGRS/USNG "30U XC 99316 10163"
 *   basemap metres "-14226.63, 6711542.48" (Web Mercator) · a plain pair "-0.1278, 51.5074". Decimal commas
 *   ("51,50740°N, 000,12780°O") and the app language's hemisphere letters are read.
 * Returns null (empty), NaN (unreadable) or { lat, lon, kind }. For kind "plain" (two bare numbers), lat is simply
 * the first number and lon the second: buildLayerData decides their order for the whole column. kind "plain" and "xy"
 * are the two whose order can't be known from the text, so they're the ones Swap latitude and longitude turns round. plainAs "merc": read
 * plain numbers as basemap metres (for a column that holds metres elsewhere).
 */
export function parseCoordPair(raw, table, plainAs) {
  table = table || ENGLISH_TABLE;
  const s = cleanCoordText(raw);
  if (s === "") return null;
  const up = s.toUpperCase();
  let m = up.match(/^(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])\s*([A-HJ-NP-V])\s*(\d{1,5})\s+(\d{1,5})$/) ||
    up.match(/^(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])\s*([A-HJ-NP-V])\s*(\d{2,10})$/);
  if (m) {
    const zone = Number(m[1]);
    let e = m[5], n = m[6];
    if (n === undefined) { if (e.length % 2) return NaN; n = e.slice(e.length / 2); e = e.slice(0, e.length / 2); }
    if (zone < 1 || zone > 60) return NaN;
    const ll = mgrsToLonLat(zone, m[2], m[3], m[4], e, n);
    return ll ? { lon: ll[0], lat: ll[1], kind: "mgrs" } : NaN;
  }
  m = up.match(/^(\d{1,2})\s*([C-HJ-NP-X])\s+(\d{1,7}(?:[.,]\d+)?)\s*M?E?\s+(\d{1,8}(?:[.,]\d+)?)\s*M?N?$/);
  if (m) {
    const zone = Number(m[1]), e = Number(m[3].replace(",", ".")), n = Number(m[4].replace(",", "."));
    if (zone < 1 || zone > 60 || e < 100000 || e > 900000 || n > 10000000) return NaN;
    const ll = utmToLonLat(zone, m[2] >= "N", e, n);
    return { lon: ll[0], lat: ll[1], kind: "utm" };
  }
  const parts = splitPair(s, table);
  if (!parts) return NaN;
  const p = parts.map((x) => coordPart(x, /\d,\d/.test(x), table));
  if (p.some((x) => x === null || Number.isNaN(x))) return NaN;
  const [a, b] = p;
  if (a.axis || b.axis) {
    if (a.axis && b.axis && a.axis === b.axis) return NaN;
    const latFirst = a.axis ? a.axis === "lat" : b.axis === "lon";
    return latFirst ? { lat: a.value, lon: b.value, kind: "hemi" } : { lat: b.value, lon: a.value, kind: "hemi" };
  }
  if (a.deg || b.deg) return { lon: a.value, lat: b.value, kind: "xy" };     // the Coordinates tool's XY: longitude first
  if (plainAs !== "merc" && Math.abs(a.value) <= 180 && Math.abs(b.value) <= 180) return { lat: a.value, lon: b.value, kind: "plain" };
  if (Math.abs(a.value) <= MERC_MAX && Math.abs(b.value) <= MERC_MAX * 1.01) {
    const ll = webMercatorToLonLat(a.value, b.value);
    return { lon: ll[0], lat: ll[1], kind: "merc" };
  }
  return NaN;
}
// Two halves of a pair: "a, b" (the tool's separator; decimal commas have no space after them), "a; b", "a<tab>b",
// "a,b" with decimal points, "51°30'N 0°7'W" (split after the first hemisphere letter) or "51.5 -0.12".
function splitPair(s, table) {
  let parts = s.split(/\s*,\s+|\s*;\s*|\t+/).filter((x) => x.trim() !== "");
  if (parts.length === 2) return parts;
  if (parts.length === 1 && (s.match(/,/g) || []).length === 1 && !/\d,\d+\s*,/.test(s)) {
    parts = s.split(","); if (parts.length === 2 && parts.every((x) => x.trim() !== "")) return parts.map((x) => x.trim());
  }
  const re = /(\p{L}+)\.?\s+/gu;
  let m;
  while ((m = re.exec(s))) {
    if (!table[m[1].toUpperCase()]) continue;
    const first = s.slice(0, m.index + m[0].length).trim(), rest = s.slice(m.index + m[0].length).trim();
    if (rest) return [first, rest];
  }
  const ws = s.trim().split(/\s+/);
  if (ws.length === 2 && ws.every((x) => /^[-+]?\d+([.,]\d+)?°?$/.test(x))) return ws;
  return null;
}
// Column names that suggest both coordinates in one column (lower-cased, accents, spaces and punctuation removed).
const PAIR_NAMES = ["coordinates", "coordinate", "coords", "coord", "location", "position", "latlong", "latlon", "longlat", "lonlat",
  "xy", "gps", "point", "coordenadas", "coordonnees", "koordinaten", "coordinaten", "koordinatak", "koordinaatit",
  "ubicacion", "posicion", "localizacao", "posicao"];
/**
 * The column, if any, whose cells are coordinate pairs: at least 80% of its filled cells must read as one. A column of
 * plain number pairs ("3, 4") only counts when its name suggests coordinates or its numbers have decimals.
 */
export function detectPairColumn(header, rows, table) {
  let best = -1, bestScore = 0;
  header.forEach((h, i) => {
    let filled = 0, ok = 0, allPlain = true, decimals = false;
    for (const r of rows) {
      const raw = r[i];
      if (raw == null || String(raw).trim() === "") continue;
      filled++;
      const p = parseCoordPair(raw, table);
      if (!p || Number.isNaN(p)) continue;
      ok++;
      if (p.kind !== "plain") allPlain = false;
      if (/\d[.,]\d/.test(String(raw))) decimals = true;
    }
    if (!filled || ok < 1 || ok / filled < 0.8) return;
    const named = PAIR_NAMES.includes(normName(h));
    if (allPlain && !named && !decimals) return;
    const score = ok / filled + (named ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/**
 * Turn parsed rows into features + fields. Column types are inferred: a column is numeric when every
 * non-empty cell is a number (decimal commas allowed when the file uses them).
 * latIdx === lonIdx: one column holds both coordinates. Its order is read from the text where it can be (letters,
 * grid references). XY is longitude first, as the Coordinates tool writes it. Bare number pairs are longitude first
 * too, because the tool copies XY without degree signs after XY is picked again in its format list; a column named
 * like "Lat/Long" is read latitude first instead, and a column that only fits the other way round is turned round.
 * opts.swapped turns XY and bare pairs round (Swap latitude and longitude).
 */
const LAT_FIRST_NAMES = ["latlong", "latlon", "latlng", "latitudelongitude", "latitudlongitud", "latitudinelongitudine", "breitelange",
  "breitelaenge", "latitudelongitudedd", "gpslatlong"];
export function buildLayerData(fileName, parsed, latIdx, lonIdx, opts) {
  const { header, rows, delim } = parsed;
  const table = parsed.dirTable || ENGLISH_TABLE;
  const pairMode = latIdx === lonIdx;
  let pairs = null;
  if (pairMode) {
    pairs = rows.map((r) => parseCoordPair(r[latIdx], table));
    // basemap metres near 0°, 0° look like degrees: if any row is clearly metres, the column is metres
    if (pairs.some((p) => p && p.kind === "merc")) pairs = pairs.map((p, r) => (p && p.kind === "plain" ? parseCoordPair(rows[r][latIdx], table, "merc") : p));
    const ok = (p) => p && !Number.isNaN(p);
    const plain = pairs.filter((p) => ok(p) && p.kind === "plain");   // first number in .lat, second in .lon
    let plainLonFirst = !LAT_FIRST_NAMES.includes(normName(header[latIdx]));
    if (pairs.some((p) => ok(p) && p.kind === "xy")) plainLonFirst = true;   // the same tool's XY, some with degree signs
    const fits = (lonFirst) => plain.every((p) => Math.abs(lonFirst ? p.lon : p.lat) <= 90 && Math.abs(lonFirst ? p.lat : p.lon) <= 180);
    if (plain.length && !fits(plainLonFirst) && fits(!plainLonFirst)) plainLonFirst = !plainLonFirst;
    const swapped = !!(opts && opts.swapped);
    const turn = (p) => ({ ...p, lat: p.lon, lon: p.lat });
    pairs = pairs.map((p) => (!ok(p) ? p : p.kind === "plain" ? (plainLonFirst !== swapped ? turn(p) : p) : p.kind === "xy" && swapped ? turn(p) : p));
  }
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
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r];
    let lat, lon;
    if (pairMode) { const p = pairs[r]; lat = p && !Number.isNaN(p) ? p.lat : p; lon = p && !Number.isNaN(p) ? p.lon : p; }
    else { lat = parseCoord(cells[latIdx], decComma[latIdx], "lat", table); lon = parseCoord(cells[lonIdx], decComma[lonIdx], "lon", table); }
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
  const coordNames = pairMode ? [names[latIdx]] : [names[latIdx], names[lonIdx]];
  const { numeric, categorical, categoricalText } = columnKinds(fields, features, coordNames);
  // Swap only makes sense where the order is a guess: two columns, or pairs without letters (plain numbers, XY)
  const swappable = !pairMode || pairs.some((p) => p && !Number.isNaN(p) && (p.kind === "plain" || p.kind === "xy"));
  return { ok: true, fileName, features, fields, numeric, categorical, categoricalText, dropped, coordNames, swappable };
}

/**
 * Which columns can be styled by number (size, shade) and which by type: text columns with 2 to 12 different values.
 * Number columns are never types: in a small file, counts (litter tallies) can't be told from codes.
 * categoricalText is the same list (kept for callers that ask for text categories).
 */
export function columnKinds(fields, features, coordNames) {
  const numeric = [], categoricalText = [];
  const distinct = (name) => {
    const seen = new Set();
    for (const ft of features) {
      const v = ft.attributes[name];
      if (v !== null && v !== undefined && v !== "") seen.add(v);
      if (seen.size > 12) break;
    }
    return seen;
  };
  for (const f of fields) {
    if (f.type === "esriFieldTypeOID" || f.name === "_pieTotal" || coordNames.includes(f.name)) continue;
    if (f.type !== "esriFieldTypeString") {
      numeric.push(f.name);
      continue;
    }
    const n = distinct(f.name).size;
    if (n >= 2 && n <= 12) categoricalText.push(f.name);
  }
  return { numeric, categorical: categoricalText.slice(), categoricalText };
}

// Columns that look like identifiers or dates rather than amounts: left out of a pie chart unless chosen.
const ID_LIKE = /\b(id|code|no|nr|num|number|ref|year|date|month|day)\b/i;
export const PIE_MAX = 8, PIE_MIN = 2;
/** The columns a pie chart starts with: the number columns that don't look like IDs, up to eight. */
export function defaultPieFields(st) {
  const amounts = st.numeric.filter((n) => !ID_LIKE.test(aliasOf(st, n)));
  return (amounts.length >= PIE_MIN ? amounts : st.numeric).slice(0, PIE_MAX);
}

/**
 * The styling panel's settings for a spreadsheet layer already on the map, read back from its saved definition
 * (the feature collection this app writes: fields, REST renderer, labels, features). Works for a layer added in this
 * session and for one in a map opened from a file. Returns { ok:false } when the definition can't be read.
 */
export function stateFromLayerDef(def) {
  if (!def || !Array.isArray(def.fields) || !Array.isArray(def.features) || !def.features.length) return { ok: false };
  const fields = def.fields.filter((f) => f && f.name && f.name !== "_pieTotal");
  const features = def.features;
  const nameOfAlias = (i) => (i >= 0 ? fields[i].name : null);
  const ll = detectLatLon(fields.map((f) => f.alias || f.name));
  const coordNames = ll.latIdx >= 0 && ll.lonIdx >= 0 ? [nameOfAlias(ll.latIdx), nameOfAlias(ll.lonIdx)] : [];
  const { numeric, categorical, categoricalText } = columnKinds(fields, features, coordNames);
  const st = { ok: true, fileName: def.title || "My data", features, fields, numeric, categorical, categoricalText, dropped: 0, coordNames };
  const r = def.renderer || {};
  const vv = Array.isArray(r.visualVariables) ? r.visualVariables : [];
  const sizeVV = vv.find((v) => v && v.type === "sizeInfo"), colorVV = vv.find((v) => v && v.type === "colorInfo");
  const choices = { color: null, size: null, label: null, pie: null };
  let styleId = "simple";
  if (r.type === "pieChart") { styleId = "pie_chart"; choices.pie = (Array.isArray(r.attributes) ? r.attributes : []).map((a) => a && a.field).filter((n) => numeric.includes(n)); }
  else if (r.type === "uniqueValue") { styleId = sizeVV ? "categorical_size" : "categorical"; choices.color = r.field1 || null; }
  else if (colorVV) { styleId = "numeric_color_size"; choices.color = colorVV.field || null; }
  else if (sizeVV) styleId = "graduated";
  if (sizeVV && styleId !== "pie_chart") choices.size = sizeVV.field || null;
  const lab = Array.isArray(def.labelingInfo) && def.labelingInfo[0];
  if (lab) {
    const m = String((lab.labelExpressionInfo && lab.labelExpressionInfo.expression) || "").match(/^\$feature\.(\w+)$/) || String(lab.labelExpression || "").match(/^\[(\w+)\]$/);
    if (m && fields.some((f) => f.name === m[1])) choices.label = m[1];
  }
  // The symbol: shape, colour (single-colour styles) and size, from the renderer's symbol.
  const sym = r.symbol || r.defaultSymbol || {};
  const shape = SHAPES.some((x) => x.id === sym.style) ? sym.style : "esriSMSCircle";
  const color = Array.isArray(sym.color) && r.type !== "uniqueValue" ? sym.color.slice(0, 3) : [0, 121, 193];
  let size = Number(sym.size) || 12;
  if (r.type === "pieChart") size = Math.round((Number(r.size) || 24) / 2);
  st.symbolChoices = { shape, color, size: Math.max(6, Math.min(28, Math.round(size))), ramp: "blue" };
  if (colorVV && Array.isArray(colorVV.stops) && colorVV.stops.length) {
    const first = (colorVV.stops[0].color || []).slice(0, 3).join(",");
    const ramp = COLOR_RAMPS.find((x) => x.colors[0].join(",") === first);
    if (ramp) st.symbolChoices.ramp = ramp.id;
  }
  // Fall back to the automatic choice if the saved style no longer fits the columns (e.g. a file edited elsewhere).
  const style = DATA_STYLES.find((x) => x.id === styleId);
  const fits = style && styleAvailable(style, st)
    && (!choices.color || (styleId === "numeric_color_size" ? numeric : categorical).includes(choices.color))
    && (!choices.size || numeric.includes(choices.size))
    && (styleId !== "pie_chart" || choices.pie.length >= PIE_MIN);
  st.style = fits ? style : pickAutoStyle(st);
  st.fieldChoices = fits ? choices : { ...pickAutoFields(st.style, st), label: choices.label };
  return st;
}

// ---------- Styling (renderers in ArcGIS REST JSON, so the same definition saves to an .amap file and to a web map) ----------

export function styleAvailable(style, st) {
  const q = style.requires;
  if (q.minNumeric && st.numeric.length < q.minNumeric) return false;
  if (q.minCategorical && st.categorical.length < q.minCategorical) return false;
  return true;
}
export function pickAutoStyle(st) {
  const text = { ...st, categorical: st.categoricalText || st.categorical };
  for (const id of ["categorical_size", "categorical", "graduated", "simple"]) {
    const s = DATA_STYLES.find((x) => x.id === id);
    if (s && styleAvailable(s, text)) return s;
  }
  return DATA_STYLES[0];
}
export function pickAutoFields(style, st) {
  const choices = { color: null, size: null, label: null, pie: null };
  if (style.id === "pie_chart") { choices.pie = defaultPieFields(st); return choices; }
  if (style.id === "numeric_color_size") {
    choices.color = st.numeric[0] || null;
    choices.size = st.numeric[1] || st.numeric[0] || null;
  } else {
    if (style.fields.includes("color")) choices.color = (st.categoricalText || [])[0] || st.categorical[0] || null;
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
/** The pie chart's columns: the ones chosen (still number columns), else the defaults. */
export function pieFields(st) {
  const chosen = ((st.fieldChoices && st.fieldChoices.pie) || []).filter((n) => st.numeric.includes(n)).slice(0, PIE_MAX);
  return chosen.length >= PIE_MIN ? chosen : defaultPieFields(st);
}
function pieRenderer(st) {
  const fieldsUsed = pieFields(st);
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
  const raw = [...new Set(st.features.map((f) => f.attributes[field]).filter((v) => v !== null && v !== undefined && v !== ""))];
  const values = raw.every((v) => typeof v === "number") ? raw.sort((a, b) => a - b) : raw.sort();
  return { type: "uniqueValue", field1: field, defaultSymbol: dataSymbol(st, [179, 179, 179, 200]), defaultLabel: "Other",
    uniqueValueInfos: values.map((val, i) => ({ value: String(val), label: String(val), symbol: dataSymbol(st, PALETTE_RGB[i % PALETTE_RGB.length]) })) };
}
export function aliasOf(st, name) {
  const f = (st.fields || []).find((x) => x.name === name);
  return (f && f.alias) || String(name).replace(/_/g, " ");
}
export function buildRenderer(st) {
  const style = st.style, c = st.fieldChoices;
  const colorIsNumeric = style.id === "numeric_color_size";   // "By type" colours a number code by its values
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
