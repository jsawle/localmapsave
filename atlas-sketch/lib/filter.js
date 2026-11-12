// Filter: the conditions a person builds in the Filter panel, and the SQL they are saved as.
// A layer's filter is saved in the web map as its definitionExpression (Web Map Specification, layerDefinition), which
// is how Map Viewer saves filters too. Nothing else is stored, so the conditions shown in the panel are read back from
// the SQL: the forms this module writes are the forms it reads. SQL it can't read (written by hand, or by another app
// in a form not listed here) is kept as it is and stays on; conditions added in the panel are added to it.
// No ArcGIS SDK here, so it runs in Node for the unit tests.
export const FILTER_VERSION = "1.2";   // 1.2: "is one of" / "is not one of" (a list, written as IN / NOT IN), so a list filter set by a map's author is read as a condition
export const MAX_CONDITIONS = 6;

const NUMBER_TYPES = new Set(["small-integer", "integer", "single", "double", "long", "big-integer",
  "esriFieldTypeSmallInteger", "esriFieldTypeInteger", "esriFieldTypeSingle", "esriFieldTypeDouble", "esriFieldTypeBigInteger"]);
const TEXT_TYPES = new Set(["string", "esriFieldTypeString"]);
/** "number", "text", or null for a field the panel can't filter on (dates, ids, geometry...). */
export function fieldKind(f) { return !f ? null : NUMBER_TYPES.has(f.type) ? "number" : TEXT_TYPES.has(f.type) ? "text" : null; }

// The conditions offered for each kind of field, in Map Viewer's order and wording (see strings.js, filterOp_*).
export const OPERATORS = {
  number: ["is", "isNot", "isOneOf", "isNotOneOf", "atLeast", "atMost", "greater", "less", "between", "blank", "notBlank"],
  text: ["is", "isNot", "isOneOf", "isNotOneOf", "contains", "notContains", "startsWith", "endsWith", "blank", "notBlank"]
};
export const DEFAULT_OPERATOR = { number: "atLeast", text: "is" };
const COMPARE = { is: "=", isNot: "<>", atLeast: ">=", atMost: "<=", greater: ">", less: "<" };
const COMPARE_BACK = { "=": "is", "<>": "isNot", "!=": "isNot", ">=": "atLeast", "<=": "atMost", ">": "greater", "<": "less" };
/** How the SDK's histogram slider shows each condition (its rangeType), or null when the histogram doesn't apply. */
export function rangeTypeFor(op) {
  return ({ is: "equal", isNot: "not-equal", atLeast: "at-least", atMost: "at-most", greater: "greater-than", less: "less-than", between: "between" })[op] || null;
}
export const needsValue = (op) => op !== "blank" && op !== "notBlank";
/** Conditions whose value is a list (c.values), written as IN (...) / NOT IN (...). */
export const isListOp = (op) => op === "isOneOf" || op === "isNotOneOf";
export const MAX_LIST = 250;
const goodList = (v) => Array.isArray(v) && v.length > 0 && v.length <= MAX_LIST && v.every((x) => typeof x === "string" && x !== "" && x.length <= 500);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NUM = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const findField = (fields, name) => (fields || []).find((f) => f && f.name === name) || (fields || []).find((f) => f && String(f.name).toLowerCase() === String(name).toLowerCase());
const num = (v) => { if (typeof v === "number") return Number.isFinite(v) ? v : null; if (typeof v !== "string" || v.trim() === "") return null; const n = Number(v.trim()); return Number.isFinite(n) ? n : null; };
const quote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// Numbers are written without exponents where possible, so the SQL reads like what was typed.
const numText = (n) => { const s = String(n); return /e/i.test(s) ? n.toFixed(20).replace(/\.?0+$/, "") : s; };

/** Is the condition filled in enough to filter with? */
export function conditionComplete(c, fields) {
  const f = c && findField(fields, c.field), kind = fieldKind(f);
  if (!kind || !IDENT.test(f.name) || !OPERATORS[kind].includes(c.op)) return false;
  if (!needsValue(c.op)) return true;
  if (isListOp(c.op)) return goodList(c.values) && (kind !== "number" || c.values.every((v) => num(v) !== null));
  if (kind === "number") return num(c.value) !== null && (c.op !== "between" || num(c.value2) !== null);
  return typeof c.value === "string" && c.value !== "" && c.value.length <= 500;
}
/** One condition as SQL, or "" when it isn't complete. */
export function conditionToSql(c, fields) {
  if (!conditionComplete(c, fields)) return "";
  const f = findField(fields, c.field), kind = fieldKind(f), n = f.name;
  if (c.op === "blank") return n + " IS NULL";
  if (c.op === "notBlank") return n + " IS NOT NULL";
  if (isListOp(c.op)) return n + (c.op === "isNotOneOf" ? " NOT IN (" : " IN (") + c.values.map((v) => (kind === "number" ? numText(num(v)) : quote(v))).join(",") + ")";
  if (kind === "number") {
    if (c.op === "between") { const a = num(c.value), b = num(c.value2); return n + " BETWEEN " + numText(Math.min(a, b)) + " AND " + numText(Math.max(a, b)); }
    return n + " " + COMPARE[c.op] + " " + numText(num(c.value));
  }
  const v = c.value;
  if (c.op === "is" || c.op === "isNot") return n + " " + COMPARE[c.op] + " " + quote(v);
  const like = c.op === "startsWith" ? v + "%" : c.op === "endsWith" ? "%" + v : "%" + v + "%";
  return n + (c.op === "notContains" ? " NOT LIKE " : " LIKE ") + quote(like);
}
/**
 * The SQL for a set of conditions. match: "all" (AND) or "any" (OR). Conditions that aren't complete are left out.
 * base: SQL that was already on the layer and can't be shown as conditions; the conditions are added to it.
 */
export function buildWhere(conditions, match, fields, base) {
  const parts = (conditions || []).map((c) => conditionToSql(c, fields)).filter(Boolean);
  const own = parts.length > 1 ? parts.map((p) => "(" + p + ")").join(match === "any" ? " OR " : " AND ") : parts[0] || "";
  const b = typeof base === "string" ? base.trim() : "";
  if (!b) return own;
  return own ? "(" + b + ") AND (" + own + ")" : b;
}

// ---- reading SQL back into conditions
// Split at the top level (outside quotes and brackets) on one joining word. Returns null if brackets or quotes don't match.
function splitTop(sql, word) {
  const parts = []; let depth = 0, start = 0, i = 0;
  const up = sql.toUpperCase(), w = " " + word + " ";
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") { i++; while (i < sql.length) { if (sql[i] === "'") { if (sql[i + 1] === "'") i++; else break; } i++; } if (i >= sql.length) return null; i++; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth < 0) return null; }
    else if (depth === 0 && up.startsWith(w, i)) { parts.push(sql.slice(start, i)); i += w.length; start = i; continue; }
    i++;
  }
  if (depth !== 0) return null;
  parts.push(sql.slice(start));
  return parts.map((p) => p.trim());
}
// Take off brackets that wrap the whole of the text: "(a = 1)" -> "a = 1", but not "(a = 1) AND (b = 2)".
function unwrap(s) {
  s = s.trim();
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0, wraps = true, i = 0;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (ch === "'") { i++; while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) { if (s[i] === "'") i++; i++; } continue; }
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0 && i < s.length - 1) { wraps = false; break; } }
    }
    if (!wraps) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}
const unquote = (q) => q.slice(1, -1).replace(/''/g, "'");
// 'a','b''c', 'd'  ->  ["a", "b'c", "d"], or null if it isn't a list of quoted texts
function parseTextList(inner) {
  const out = []; let i = 0; const n = inner.length;
  const skip = () => { while (i < n && /\s/.test(inner[i])) i++; };
  for (;;) {
    skip(); if (inner[i] !== "'") return null;
    let j = i + 1, v = "";
    for (;;) { if (j >= n) return null; if (inner[j] === "'") { if (inner[j + 1] === "'") { v += "'"; j += 2; continue; } break; } v += inner[j++]; }
    out.push(v); i = j + 1; skip();
    if (i >= n) return out;
    if (inner[i] !== ",") return null; i++;
  }
}
function parseCondition(text, fields) {
  const s = unwrap(text);
  const li = s.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(NOT\s+)?IN\s*\(([\s\S]*)\)$/i);
  if (li) {
    const f = findField(fields, li[1]), kind = fieldKind(f);
    const nums = kind === "number" ? li[3].split(",").map((x) => x.trim()) : null;
    const list = kind === "text" ? parseTextList(li[3]) : nums && nums.every((x) => new RegExp("^" + NUM + "$").test(x)) ? nums : null;
    return list && goodList(list) ? { field: f.name, op: li[2] ? "isNotOneOf" : "isOneOf", value: "", value2: "", values: list } : null;
  }
  let m = s.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+IS\s+(NOT\s+)?NULL$/i);
  if (m) { const f = findField(fields, m[1]); return fieldKind(f) ? { field: f.name, op: m[2] ? "notBlank" : "blank", value: "", value2: "" } : null; }
  m = s.match(new RegExp('^"?([A-Za-z_][A-Za-z0-9_]*)"?\\s+BETWEEN\\s+(' + NUM + ")\\s+AND\\s+(" + NUM + ")$", "i"));
  if (m) { const f = findField(fields, m[1]); return fieldKind(f) === "number" ? { field: f.name, op: "between", value: m[2], value2: m[3] } : null; }
  m = s.match(new RegExp('^"?([A-Za-z_][A-Za-z0-9_]*)"?\\s*(<>|!=|>=|<=|=|>|<)\\s*(' + NUM + ")$"));
  if (m) { const f = findField(fields, m[1]); return fieldKind(f) === "number" ? { field: f.name, op: COMPARE_BACK[m[2]], value: m[3], value2: "" } : null; }
  m = s.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s*(<>|!=|=)\s*('(?:[^']|'')*')$/);
  if (m) { const f = findField(fields, m[1]); return fieldKind(f) === "text" ? { field: f.name, op: COMPARE_BACK[m[2]], value: unquote(m[3]), value2: "" } : null; }
  m = s.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(NOT\s+)?LIKE\s+('(?:[^']|'')*')$/i);
  if (m) {
    const f = findField(fields, m[1]); if (fieldKind(f) !== "text") return null;
    const v = unquote(m[3]), a = v.startsWith("%"), b = v.endsWith("%") && v.length > 1, inner = v.slice(a ? 1 : 0, b ? v.length - 1 : v.length);
    if (!inner || /[%_]/.test(inner)) return null;
    if (m[2]) return a && b ? { field: f.name, op: "notContains", value: inner, value2: "" } : null;
    const op = a && b ? "contains" : b ? "startsWith" : a ? "endsWith" : null;
    return op ? { field: f.name, op, value: inner, value2: "" } : null;
  }
  return null;
}
/**
 * A layer's saved SQL as panel conditions.
 * Returns { conditions, match, base }: base is "" when all of the SQL was read; otherwise it is the whole SQL, kept as
 * it is (conditions is then empty, and new conditions are added to it by buildWhere).
 */
export function parseWhere(sql, fields) {
  const text = typeof sql === "string" ? sql.trim() : "";
  if (!text || /^1\s*=\s*1$/.test(text)) return { conditions: [], match: "all", base: "" };
  const whole = unwrap(text);
  const one = parseCondition(whole, fields);
  if (one) return { conditions: [one], match: "all", base: "" };
  for (const [word, match] of [["AND", "all"], ["OR", "any"]]) {
    const parts = splitTop(whole, word);
    if (!parts || parts.length < 2 || parts.length > MAX_CONDITIONS) continue;
    const conds = parts.map((p) => parseCondition(p, fields));
    if (conds.every(Boolean)) return { conditions: conds, match, base: "" };
  }
  return { conditions: [], match: "all", base: text };
}
/** The fields the panel offers: those the layer's pop-up shows (when it has a field list), else every number or text field. */
export function filterFields(fields, popupFieldNames, oidField) {
  const usable = (fields || []).filter((f) => fieldKind(f) && IDENT.test(f.name) && f.name !== oidField && !/^_/.test(f.name));
  const shown = new Set(popupFieldNames || []);
  const inPopup = usable.filter((f) => shown.has(f.name));
  return inPopup.length ? inPopup : usable;
}
