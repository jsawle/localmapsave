// Unit tests for the filter conditions <-> SQL module, and the time settings a saved map keeps. Run: node atlas-sketch/tests/filter.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as F from "../lib/filter.js";
import * as doc from "../lib/doc.js";

let n = 0; const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error("FAIL:", name); throw e; } };
const fields = [{ name: "OBJECTID", type: "oid" }, { name: "Magnitude", type: "double", alias: "Magnitude" }, { name: "Year", type: "integer" },
  { name: "Place", type: "string" }, { name: "Type", type: "esriFieldTypeString" }, { name: "When", type: "date" }];
const C = (field, op, value, value2) => ({ field, op, value: value ?? "", value2: value2 ?? "" });

test("field kinds", () => {
  assert.equal(F.fieldKind(fields[1]), "number"); assert.equal(F.fieldKind(fields[3]), "text"); assert.equal(F.fieldKind(fields[4]), "text");
  assert.equal(F.fieldKind(fields[0]), null); assert.equal(F.fieldKind(fields[5]), null); assert.equal(F.fieldKind(null), null);
});
test("number conditions", () => {
  assert.equal(F.conditionToSql(C("Magnitude", "atLeast", "7.4"), fields), "Magnitude >= 7.4");
  assert.equal(F.conditionToSql(C("Magnitude", "is", 8), fields), "Magnitude = 8");
  assert.equal(F.conditionToSql(C("Magnitude", "isNot", "8"), fields), "Magnitude <> 8");
  assert.equal(F.conditionToSql(C("Year", "between", "2010", "1990"), fields), "Year BETWEEN 1990 AND 2010");
  assert.equal(F.conditionToSql(C("Year", "blank"), fields), "Year IS NULL");
  assert.equal(F.conditionToSql(C("Year", "notBlank"), fields), "Year IS NOT NULL");
  assert.equal(F.conditionToSql(C("Year", "less", "-3"), fields), "Year < -3");
});
test("text conditions, quotes doubled", () => {
  assert.equal(F.conditionToSql(C("Place", "is", "O'Higgins"), fields), "Place = 'O''Higgins'");
  assert.equal(F.conditionToSql(C("Place", "contains", "Chile"), fields), "Place LIKE '%Chile%'");
  assert.equal(F.conditionToSql(C("Place", "notContains", "Sea"), fields), "Place NOT LIKE '%Sea%'");
  assert.equal(F.conditionToSql(C("Place", "startsWith", "South"), fields), "Place LIKE 'South%'");
  assert.equal(F.conditionToSql(C("Place", "endsWith", "Island"), fields), "Place LIKE '%Island'");
});
test("incomplete or unsafe conditions give no SQL", () => {
  for (const c of [C("Magnitude", "atLeast", ""), C("Magnitude", "atLeast", "abc"), C("Magnitude", "atLeast", "7; DROP TABLE x"), C("Year", "between", "1990", ""),
    C("Nope", "is", "1"), C("When", "is", "1"), C("OBJECTID", "is", "1"), C("Place", "atLeast", "x"), C("Magnitude", "contains", "7"), C("Place", "is", ""), null])
    assert.equal(F.conditionToSql(c, fields), "");
  assert.equal(F.conditionToSql(C("Bad Name", "is", "1"), [{ name: "Bad Name", type: "double" }]), "", "a field name that isn't a plain identifier is never written into SQL");
  assert.equal(F.conditionToSql(C("Place", "is", "x' OR '1'='1"), fields), "Place = 'x'' OR ''1''=''1'", "a quote in a value stays inside the string");
});
test("several conditions, all or any, and a base expression", () => {
  const cs = [C("Magnitude", "atLeast", "7.4"), C("Year", "greater", "2000"), C("Place", "is", "")];
  assert.equal(F.buildWhere(cs, "all", fields), "(Magnitude >= 7.4) AND (Year > 2000)");
  assert.equal(F.buildWhere(cs, "any", fields), "(Magnitude >= 7.4) OR (Year > 2000)");
  assert.equal(F.buildWhere([cs[0]], "any", fields), "Magnitude >= 7.4");
  assert.equal(F.buildWhere([], "all", fields), "");
  assert.equal(F.buildWhere(cs, "any", fields, "Depth_km < 70 OR Tsunami = 'Y'"), "(Depth_km < 70 OR Tsunami = 'Y') AND ((Magnitude >= 7.4) OR (Year > 2000))");
  assert.equal(F.buildWhere([], "all", fields, " X IN (1,2) "), "X IN (1,2)");
});
test("what is written is read back the same", () => {
  const sets = [
    [[C("Magnitude", "atLeast", "7.4")], "all"],
    [[C("Magnitude", "between", "7", "8.5"), C("Place", "contains", "Chile")], "all"],
    [[C("Place", "is", "O'Higgins (north)"), C("Type", "startsWith", "A"), C("Year", "blank")], "any"],
    [[C("Place", "is", "a AND b"), C("Place", "isNot", "x OR y")], "all"],
    [[C("Place", "endsWith", "Island"), C("Place", "notContains", "Sea"), C("Year", "notBlank"), C("Year", "isNot", "1960"), C("Year", "atMost", "2020"), C("Year", "less", "-1.5e3")], "any"]
  ];
  for (const [cs, match] of sets) {
    const sql = F.buildWhere(cs, match, fields), back = F.parseWhere(sql, fields);
    assert.equal(back.base, "", sql);
    assert.equal(back.conditions.length, cs.length, sql);
    assert.equal(F.buildWhere(back.conditions, back.match, fields), sql);
    if (cs.length > 1) assert.equal(back.match, match);
  }
});
test("SQL from elsewhere: read when it's a form the panel has, kept whole when it isn't", () => {
  assert.deepEqual(F.parseWhere("magnitude>=7.4", fields).conditions, [C("Magnitude", "atLeast", "7.4")], "field names match whatever their case");
  assert.deepEqual(F.parseWhere('("Year" != 1960)', fields).conditions, [C("Year", "isNot", "1960")]);
  assert.deepEqual(F.parseWhere("Magnitude >= 7.4 AND Year > 2000", fields).conditions.map((c) => c.op), ["atLeast", "greater"]);
  for (const sql of ["UPPER(Place) LIKE '%CHILE%'", "(Magnitude >= 7 AND Year > 2000) OR Place = 'Chile'", "Depth > 5", "When > DATE '2020-01-01'",
    "Place LIKE '%a%b%'", "Place LIKE 'a_c'", "Magnitude >= 7.4 OR", "Place = 'unclosed", "((Magnitude >= 7)", "Year BETWEEN 1990 AND 2000 AND Magnitude > 7"]) {
    const r = F.parseWhere(sql, fields);
    assert.equal(r.base, sql, sql); assert.equal(r.conditions.length, 0, sql);
  }
  for (const empty of ["", "   ", "1=1", "1 = 1", null, undefined]) assert.deepEqual(F.parseWhere(empty, fields), { conditions: [], match: "all", base: "" });
});
test("mixed AND and OR at the top level is not taken apart", () => {
  const r = F.parseWhere("(Magnitude >= 7) AND (Year > 2000) OR (Place = 'x')", fields);
  assert.equal(r.conditions.length, 0); assert.ok(r.base);
});
test("the histogram's range type for each condition", () => {
  assert.equal(F.rangeTypeFor("atLeast"), "at-least"); assert.equal(F.rangeTypeFor("between"), "between"); assert.equal(F.rangeTypeFor("isNot"), "not-equal");
  assert.equal(F.rangeTypeFor("blank"), null); assert.equal(F.rangeTypeFor("contains"), null);
});
test("fields offered: the pop-up's, else every number and text field; never the id or hidden fields", () => {
  const all = [...fields, { name: "_pieTotal", type: "double" }];
  assert.deepEqual(F.filterFields(all, [], "OBJECTID").map((f) => f.name), ["Magnitude", "Year", "Place", "Type"]);
  assert.deepEqual(F.filterFields(all, ["Place", "Magnitude", "When"], "OBJECTID").map((f) => f.name), ["Magnitude", "Place"]);
  assert.deepEqual(F.filterFields([{ name: "ObjectId", type: "integer" }, { name: "Trees", type: "integer" }], null, "ObjectId").map((f) => f.name), ["Trees"]);
});
test("a spreadsheet layer's filter is saved in its layerDefinition and read back", () => {
  const def = { id: "csv1", title: "Trees", geometryType: "point", objectIdField: "ObjectId",
    fields: [{ name: "ObjectId", alias: "ObjectId", type: "esriFieldTypeOID" }, { name: "Height", alias: "Height", type: "esriFieldTypeDouble" }],
    renderer: null, labelingInfo: null, popupInfo: { title: "", fieldInfos: [] }, features: [{ geometry: { x: 1, y: 2, spatialReference: { wkid: 102100 } }, attributes: { ObjectId: 1, Height: 9 } }],
    definitionExpression: "Height >= 5" };
  const op = doc.dataDefToOperationalLayer(def, true, 1);
  assert.equal(op.featureCollection.layers[0].layerDefinition.definitionExpression, "Height >= 5");
  assert.equal(doc.operationalLayerToDataDef(op).definitionExpression, "Height >= 5");
  const plain = doc.dataDefToOperationalLayer({ ...def, definitionExpression: undefined }, true, 1);
  assert.ok(!("definitionExpression" in plain.featureCollection.layers[0].layerDefinition), "no filter: the property is left out");
  assert.equal(doc.operationalLayerToDataDef(plain).definitionExpression, undefined);
});
test("time settings: only what the Web Map Specification defines is kept, and a saved map keeps them", () => {
  const w = { timeSlider: { properties: { startTime: -6144235258000, endTime: -5892119998000, numberOfStops: 10, thumbCount: 2, thumbMovingRate: 2000, loop: true,
    currentTimeExtent: [null, -6100000000000], timeStopInterval: { interval: 5, units: "esriTimeUnitsYears" }, stops: [1, 2, "x"], evil: "<script>", onclick: "x" } }, other: { a: 1 } };
  const c = doc.cleanTimeWidgets(w);
  assert.deepEqual(Object.keys(c), ["timeSlider"]);
  assert.deepEqual(c.timeSlider.properties, { startTime: -6144235258000, endTime: -5892119998000, thumbMovingRate: 2000, numberOfStops: 10, thumbCount: 2, loop: true,
    currentTimeExtent: [null, -6100000000000], stops: [1, 2], timeStopInterval: { interval: 5, units: "esriTimeUnitsYears" } });
  for (const bad of [null, {}, { timeSlider: {} }, { timeSlider: { properties: { thumbCount: 7, startTime: "1", timeStopInterval: { interval: 1, units: "fortnights" } } } }]) assert.equal(doc.cleanTimeWidgets(bad), null);
  const wm = doc.docToWebMap({ graphics: [], layers: [], bookmarks: [] }, { widgets: w, appVersion: "t" });
  assert.deepEqual(wm.widgets, c);
  assert.equal(doc.readWebMap(wm).webmap.widgets.timeSlider.properties.numberOfStops, 10, "and they come back when the file is opened");
  assert.ok(!("widgets" in doc.docToWebMap({ graphics: [], layers: [], bookmarks: [] }, { appVersion: "t" })), "a map without time settings has no widgets");
});
test("release: every module address carries the app version, and the filter has its own version", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8"), html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ver = app.match(/const APP_VERSION = "([^"]+)"/)[1];
  assert.ok(html.includes('src="./app.js?v=' + ver + '"'));
  for (const m of app.matchAll(/from "\.\/lib\/[\w-]+\.js\?v=([^"]+)"/g)) assert.equal(m[1], ver);
  assert.match(F.FILTER_VERSION, /^\d+\.\d+$/);
  assert.ok(app.includes("FILTER_VERSION"));
});
// Lists (Filter 1.2): "is one of" / "is not one of", written as IN / NOT IN
test("a list is written as IN and read back", () => {
  const c1 = { field: "Place", op: "isOneOf", value: "", value2: "", values: ["Lisbon", "St John's", "A, B"] };
  assert.ok(F.conditionComplete(c1, fields));
  const sql = F.buildWhere([c1], "all", fields);
  assert.equal(sql, "Place IN ('Lisbon','St John''s','A, B')");
  assert.deepEqual(F.parseWhere(sql, fields), { conditions: [c1], match: "all", base: "" });
  const c2 = { ...c1, op: "isNotOneOf" };
  assert.equal(F.buildWhere([c2], "all", fields), "Place NOT IN ('Lisbon','St John''s','A, B')");
  assert.deepEqual(F.parseWhere("Place not in ( 'Lisbon' , 'St John''s','A, B' )", fields).conditions, [c2]);
});
test("a list needs a value, and has limits", () => {
  assert.equal(F.conditionComplete({ field: "Place", op: "isOneOf", values: [] }, fields), false);
  assert.equal(F.conditionComplete({ field: "Place", op: "isOneOf" }, fields), false);
  assert.equal(F.conditionComplete({ field: "Place", op: "isOneOf", values: Array.from({ length: 251 }, (_, i) => "v" + i) }, fields), false);
  assert.equal(F.conditionComplete({ field: "Magnitude", op: "isOneOf", values: ["1", "x"] }, fields), false);   // a number field's list is numbers
  assert.ok(F.OPERATORS.text.includes("isOneOf") && F.OPERATORS.number.includes("isOneOf"));
  const nl = { field: "Year", op: "isOneOf", value: "", value2: "", values: ["5", "4", "3", "2", "1"] };
  assert.equal(F.buildWhere([nl], "all", fields), "Year IN (5,4,3,2,1)");
  assert.deepEqual(F.parseWhere("Year IN (5,4,3,2,1)", fields).conditions, [nl]);
});
test("what isn't a list of quoted texts is not read as one", () => {
  for (const sql of ["Place IN (SELECT x FROM y)", "Place IN ('a' 'b')", "Place IN ('a',)", "Place IN ()", "Magnitude IN (1,'b')", "Place IN (1,2)", "Place IN ('a') OR 1=1 --"]) {
    const r = F.parseWhere(sql, fields);
    assert.ok(r.conditions.length === 0 ? r.base === sql : r.conditions.every((x) => x.op !== "isOneOf" || F.buildWhere([x], "all", fields) !== sql || sql === "Place IN ('a')"), sql);
  }
  assert.equal(F.parseWhere("Place IN (SELECT x FROM y)", fields).base, "Place IN (SELECT x FROM y)");
  assert.equal(F.parseWhere("Magnitude IN (1,'b')", fields).base, "Magnitude IN (1,'b')");
});
test("a map author's list filter, and a condition added to it, open as two conditions", () => {
  const bf = [{ name: "Dates", type: "string" }, { name: "Battle", type: "string" }, { name: "Victor", type: "string" }];
  const author = "Dates IN ('April 19, 1775','April 19, 1775 to March 17, 1776','August 27, 1776','August 8, 1775 to August 9, 1775','December 21, 1776 to December 23, 1776','December 26, 1776','December 31, 1775','December 8, 1776 to December 12, 1776','December 9, 1775','February 27, 1776','July 8, 1776 to July 10, 1776','June 17, 1775','June 28, 1776','June 28, 1776 to June 29, 1776','May 10, 1775','May 12, 1775','November 16, 1776','November 20, 1776','October 11, 1776','October 18, 1776','October 28, 1776')";
  const a = F.parseWhere(author, bf);
  assert.equal(a.base, ""); assert.equal(a.conditions.length, 1); assert.equal(a.conditions[0].op, "isOneOf"); assert.equal(a.conditions[0].values.length, 21);
  assert.equal(a.conditions[0].values[1], "April 19, 1775 to March 17, 1776");
  assert.equal(F.buildWhere(a.conditions, "all", bf), author);   // written back exactly as the author had it
  const both = F.parseWhere("(" + author + ") AND (Battle = 'Crown Point')", bf);   // what beta.17 saved after a condition was added
  assert.equal(both.base, ""); assert.equal(both.match, "all"); assert.deepEqual(both.conditions.map((x) => x.op), ["isOneOf", "is"]); assert.equal(both.conditions[1].value, "Crown Point");
  assert.deepEqual(F.parseWhere("iglesia_ca NOT IN ('Mision','Mision cabecera','Mision capital')", [{ name: "iglesia_ca", type: "string" }]).conditions[0].op, "isNotOneOf");
});
console.log("All " + n + " filter tests passed.");
