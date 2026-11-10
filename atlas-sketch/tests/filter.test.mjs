// Unit tests for the filter conditions <-> SQL module. Run: node atlas-sketch/tests/filter.test.mjs
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
  for (const sql of ["Magnitude IN (7, 8)", "UPPER(Place) LIKE '%CHILE%'", "(Magnitude >= 7 AND Year > 2000) OR Place = 'Chile'", "Depth > 5", "When > DATE '2020-01-01'",
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
test("release: every module address carries the app version, and the filter has its own version", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8"), html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ver = app.match(/const APP_VERSION = "([^"]+)"/)[1];
  assert.ok(html.includes('src="./app.js?v=' + ver + '"'));
  for (const m of app.matchAll(/from "\.\/lib\/[\w-]+\.js\?v=([^"]+)"/g)) assert.equal(m[1], ver);
  assert.match(F.FILTER_VERSION, /^\d+\.\d+$/);
  assert.ok(app.includes("FILTER_VERSION"));
});
console.log("All " + n + " filter tests passed.");
