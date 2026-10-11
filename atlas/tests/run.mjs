// Unit tests for the parts of the app that don't need the ArcGIS SDK. Run: node atlas/tests/run.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as csv from "../lib/csv.js";
import * as doc from "../lib/doc.js";
import { DEFAULT_STRINGS } from "../lib/strings.js";

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error("FAIL:", name); throw e; } };

// ---------- CSV ----------
test("sniff comma / semicolon / tab", () => {
  assert.equal(csv.sniffDelimiter("a,b,c\n1,2,3\n"), ",");
  assert.equal(csv.sniffDelimiter("a;b;c\n1,5;2,5;3\n"), ";");
  assert.equal(csv.sniffDelimiter("a\tb\tc\n1\t2\t3\n"), "\t");
  assert.equal(csv.sniffDelimiter('name,note\n"A, B","x;y"\n'), ",");
});
test("quoted cells, escaped quotes, line breaks in quotes", () => {
  const rows = csv.parseRows('a,b\n"x, y","say ""hi"""\n"line1\nline2",2\r\n', ",");
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"'], ["line1\nline2", "2"]]);
});
test("readCsv errors", () => {
  assert.equal(csv.readCsv("").code, "csvEmpty");
  assert.equal(csv.readCsv("\n\nlat,lon\n1,2").code, "csvA1");
  assert.equal(csv.readCsv(",lat,lon\n,1,2").code, "csvA1col");
  assert.equal(csv.readCsv("lat,,lon\n1,2,3").code, "csvNoHeading");
  assert.equal(csv.readCsv("lat,lon\n").code, "csvNoRows");
  const big = "lat,lon\n" + Array.from({ length: 1001 }, () => "1,2").join("\n");
  const r = csv.readCsv(big); assert.equal(r.code, "csvTooMany"); assert.equal(r.params.max, 1000);
});
test("lat/long names in several languages", () => {
  for (const [h, la, lo] of [["Site,Latitude,Longitude", 1, 2], ["Sitio,Latitud,Longitud", 1, 2], ["Ort;Breite;Länge", 1, 2], ["Latitude (°),Longitude (°),x2", 0, 1], ["LAT,LNG", 0, 1], ["y,x,name", 0, 1]]) {
    const d = csv.detectLatLon(h.split(/[;,]/));
    assert.equal(d.latIdx, la, h); assert.equal(d.lonIdx, lo, h);
  }
  assert.deepEqual(csv.detectLatLon(["north", "east"]), { latIdx: -1, lonIdx: -1 });
});
test("decimal commas with semicolon files", () => {
  const p = csv.readCsv("Nombre;Latitud;Longitud;Altura\nÁrbol 1;8,98;-79,52;12,5\nÁrbol 2;9,01;-79,50;7\n");
  assert.ok(p.ok); assert.equal(p.delim, ";");
  const d = csv.buildLayerData("arboles.csv", p, p.latIdx, p.lonIdx);
  assert.ok(d.ok); assert.equal(d.features.length, 2);
  assert.equal(d.features[0].attributes.Altura, 12.5);
  assert.equal(d.fields.find((f) => f.name === "Altura").type, "esriFieldTypeDouble");
  assert.ok(Math.abs(d.features[0].geometry.y - 1004000) < 5000);
});
test("types, dropped rows, categories exclude coordinates", () => {
  const text = "Site,Latitude,Longitude,Species,Height,Count\nA,51.5,-0.12,Oak,12.5,3\nB,51.6,-0.1,Ash,8,4\nC,bad,-0.1,Oak,9,1\nD,51.7,-0.2,Birch,10,2\n";
  const p = csv.readCsv(text); const d = csv.buildLayerData("trees.csv", p, p.latIdx, p.lonIdx);
  assert.equal(d.features.length, 3); assert.equal(d.dropped, 1);
  assert.deepEqual(d.numeric, ["Height", "Count"]);
  assert.deepEqual(d.categorical, ["Site", "Species"]);
  assert.equal(d.fields.find((f) => f.name === "Count").type, "esriFieldTypeInteger");
  assert.equal(d.fields.find((f) => f.name === "Latitude").type, "esriFieldTypeString");   // column had "bad"
});
test("auto style, renderer and layer definition", () => {
  const p = csv.readCsv("Site,Latitude,Longitude,Species,Height\nA,51.5,-0.12,Oak,12.5\nB,51.6,-0.1,Ash,8\nC,51.7,-0.2,Oak,9\n");
  const st = csv.buildLayerData("trees.csv", p, p.latIdx, p.lonIdx);
  st.symbolChoices = { shape: "esriSMSCircle", color: [0, 121, 193], size: 12, ramp: "blue" };
  st.style = csv.pickAutoStyle(st); assert.equal(st.style.id, "categorical_size");
  st.fieldChoices = csv.pickAutoFields(st.style, st);
  assert.equal(st.fieldChoices.color, "Site"); assert.equal(st.fieldChoices.size, "Height");
  const def = csv.buildLayerDef(st, "csv1");
  assert.equal(def.renderer.type, "uniqueValue"); assert.equal(def.renderer.visualVariables[0].type, "sizeInfo");
  assert.equal(def.title, "trees"); assert.equal(def.features.length, 3);
  assert.ok(def.popupInfo.fieldInfos.every((f) => !["Latitude", "Longitude"].includes(f.fieldName)));
});
test("pie chart totals", () => {
  const p = csv.readCsv("Lat,Lon,Plastic,Glass,Metal\n1,1,3,2,1\n2,2,0,1,4\n");
  const st = csv.buildLayerData("litter.csv", p, p.latIdx, p.lonIdx);
  st.symbolChoices = { shape: "esriSMSCircle", color: [0, 0, 0], size: 12, ramp: "blue" };
  st.style = csv.DATA_STYLES.find((s) => s.id === "pie_chart"); st.fieldChoices = { color: null, size: null, label: null };
  const def = csv.buildLayerDef(st, "csv2");
  assert.equal(def.renderer.type, "pieChart"); assert.equal(def.features[0].attributes._pieTotal, 6);
  assert.ok(def.fields.some((f) => f.name === "_pieTotal"));
});

// ---------- Saved documents ----------
const pt = { x: -13000, y: 6700000, spatialReference: { wkid: 102100 } };
test("rejects files that aren't maps", () => {
  assert.equal(doc.sanitizeDoc({ type: "Other" }).code, "notMapFile");
  assert.equal(doc.sanitizeDoc(null).code, "notMapFile");
});
test("hardening: images, picture symbols, popups, caps", () => {
  const raw = { type: doc.DOC_TYPE, version: 3, title: "T", basemap: "item:a82ff7ce1c3a493f9d82aa89f5a1ddcf",
    graphics: [
      { geometry: pt, attributes: { kind: "point", title: "ok", imageUrl: "https://tracker.example/pixel.png", color: "#FF0000", size: 999 } },
      { geometry: pt, attributes: { kind: "point", imageUrl: "data:image/png;base64,iVBORw0KGgo=" } },
      { geometry: { foo: 1 }, attributes: {} }
    ],
    layers: [{ id: "csv1", title: "D", geometryType: "point", fields: [{ name: "ObjectId", type: "esriFieldTypeOID" }, { name: "Name", type: "esriFieldTypeString" }, { name: "bad name", type: "esriFieldTypeString" }],
      renderer: { type: "simple", symbol: { type: "esriPMS", url: "https://tracker.example/x.png" } },
      popupInfo: { title: "{Name}", description: "<img src=https://tracker.example/y.png>", mediaInfos: [{ value: { sourceURL: "https://x" } }], fieldInfos: [{ fieldName: "Name", label: "Name" }] },
      features: Array.from({ length: 6000 }, (_, i) => ({ geometry: pt, attributes: { ObjectId: i + 1, Name: "n" + i, evil: "x" } })) }],
    bookmarks: [{ title: "B", viewpoint: { center: [1, 2], zoom: 5 }, thumb: "javascript:alert(1)" }, { title: "bad", viewpoint: {} }]
  };
  const r = doc.sanitizeDoc(raw); assert.ok(r.ok);
  const d = r.doc;
  assert.equal(d.graphics.length, 2);
  assert.equal(d.graphics[0].attributes.imageUrl, ""); assert.equal(d.graphics[0].attributes.color, "#ff0000"); assert.equal(d.graphics[0].attributes.size, 64);
  assert.ok(d.graphics[1].attributes.imageUrl.startsWith("data:image/png"));
  assert.equal(d.layers[0].renderer.symbol.type, "esriSMS");
  assert.equal(JSON.stringify(d.layers[0]).includes("tracker.example"), false);
  assert.ok(!d.layers[0].fields.some((f) => f.name === "bad name"));
  assert.equal(d.layers[0].features.length + d.graphics.length, doc.MAX_FEATURES);
  assert.ok(!("evil" in d.layers[0].features[0].attributes));
  assert.equal(d.bookmarks.length, 1); assert.equal(d.bookmarks[0].thumb, null);
  assert.ok(r.skipped > 0);
});
test("reads the local-save concept (v2) and Map Studio (v4) files", () => {
  const v2 = doc.sanitizeDoc({ type: doc.DOC_TYPE, version: 2, title: "Old", basemap: "item:a82ff7ce1c3a493f9d82aa89f5a1ddcf", viewpoint: { center: [-117.16, 32.71], zoom: 15 },
    graphics: [{ geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]], spatialReference: { wkid: 102100 } }, attributes: { uid: "a", kind: "polygon", color: "#0079c1", size: 12 } },
      { geometry: pt, attributes: { kind: "text", title: "Hello", color: "#d4572a", size: 16 } }] });
  assert.ok(v2.ok); assert.equal(v2.doc.graphics[1].attributes.kind, "text"); assert.equal(v2.doc.viewpoint.zoom, 15);
  const ms = doc.sanitizeDoc({ type: doc.DOC_TYPE, version: 4, app: "Map Studio", basemap: { itemId: "a82ff7ce1c3a493f9d82aa89f5a1ddcf" }, mode: "3d",
    camera: { position: { x: 1, y: 2, z: 3000, spatialReference: { wkid: 102100 } }, heading: 10, tilt: 45 },
    portalLayers: [{ itemId: "6fd5fb24db79436e9b57f3b35a618802", type: "Feature Service", title: "1763 Proclamation Line" }, { itemId: "not-an-id" }],
    graphics: [{ geometry: pt, symbol: { type: "simple-marker", color: [226, 119, 40, 255] }, attributes: {} }] });
  assert.ok(ms.ok); assert.equal(ms.doc.basemap, "item:a82ff7ce1c3a493f9d82aa89f5a1ddcf"); assert.equal(ms.doc.mode, "3d");
  assert.equal(ms.doc.portalLayers.length, 1); assert.equal(ms.doc.graphics[0].attributes.color, "#e27728");
});
test("web map round trip keeps sketches, data and bookmarks", () => {
  const src = doc.sanitizeDoc({ type: doc.DOC_TYPE, version: 4, title: "Trip",
    graphics: [
      { geometry: pt, attributes: { uid: "p1", kind: "point", title: "Camp", description: "Night 1", color: "#0079c1", size: 12, rotation: 0 } },
      { geometry: { paths: [[[0, 0], [10, 10]]], spatialReference: { wkid: 102100 } }, attributes: { uid: "l1", kind: "polyline", color: "#d4572a", size: 8 } },
      { geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]], spatialReference: { wkid: 102100 } }, attributes: { uid: "a1", kind: "polygon", color: "#1a7f37" } },
      { geometry: pt, attributes: { uid: "t1", kind: "text", title: "It's here", color: "#2b2b2b", size: 16 } }],
    layers: [{ id: "csv9", title: "Trees", geometryType: "point", objectIdField: "ObjectId", fields: [{ name: "ObjectId", type: "esriFieldTypeOID" }, { name: "Species", type: "esriFieldTypeString" }],
      renderer: { type: "uniqueValue", field1: "Species", uniqueValueInfos: [] }, popupInfo: { title: "{Species}", fieldInfos: [{ fieldName: "Species", label: "Species" }] },
      features: [{ geometry: pt, attributes: { ObjectId: 1, Species: "Oak" } }] }],
    bookmarks: [{ title: "Start", viewpoint: { center: [-0.12, 51.5], zoom: 10 }, layers: [{ id: "__sketch", title: "Sketches", visible: false }] }] }).doc;
  const wm = doc.docToWebMap(src, { baseMap: { baseMapLayers: [], title: "B" }, sourceLayers: [{ id: "src1", layerType: "ArcGISFeatureLayer", url: "https://x/0" }, { id: "__sketch_points" }],
    portalLayers: [], extent: { xmin: 0, ymin: 0, xmax: 1, ymax: 1, spatialReference: { wkid: 102100 } }, appVersion: "1.0.0", sketchTitle: "My sketches" });
  assert.equal(wm.authoringApp, doc.AUTHORING_APP);
  assert.equal(wm.operationalLayers.filter((o) => o.id === "src1").length, 1);
  assert.equal(wm.operationalLayers.filter((o) => o.id === "__sketch_points").length, 1);   // old copy dropped, fresh one written
  const own = wm.operationalLayers.filter(doc.isOwnLayerJson);
  assert.equal(own.length, 5);   // data + points, lines, areas, text
  const text = own.find((o) => o.id === "__sketch_text");
  assert.ok(text.featureCollection.layers[0].layerDefinition.drawingInfo.labelingInfo[0].where.includes("''") === false);
  const back = doc.operationalLayersToSketch(JSON.parse(JSON.stringify(own)));
  assert.equal(back.length, 4);
  assert.deepEqual(back.map((g) => g.attributes.uid).sort(), ["a1", "l1", "p1", "t1"]);
  assert.equal(back.find((g) => g.attributes.uid === "t1").attributes.kind, "text");
  assert.equal(back.find((g) => g.attributes.uid === "p1").attributes.description, "Night 1");
  const data = doc.operationalLayerToDataDef(own.find((o) => o.id === "__data_csv9"));
  assert.equal(data.id, "csv9"); assert.equal(data.features[0].attributes.Species, "Oak"); assert.equal(data.renderer.type, "uniqueValue");
  assert.equal(wm.bookmarks[0].name, "Start");
  const bms = doc.specToBookmarks(wm.bookmarks);
  assert.ok(Math.abs(bms[0].viewpoint.center[0] + 0.12) < 1e-6 && Math.abs(bms[0].viewpoint.zoom - 10) < 1e-6);
  assert.equal(doc.cleanBookmarks(wm.atlasBookmarks)[0].layers[0].visible, false);
  JSON.stringify(wm);
});
test("every config translates only known strings", () => {
  for (const f of ["default", "mapmaker", "example-es"]) {
    const c = JSON.parse(readFileSync(new URL("../config/" + f + ".json", import.meta.url)));
    for (const k of Object.keys(c.strings || {})) assert.ok(k in DEFAULT_STRINGS, f + ": unknown string " + k);
    for (const k of ["contentGroup", "basemapGroup", "defaultBasemap"]) assert.match(c[k], /^[0-9a-f]{32}$/);
  }
});
console.log("All " + passed + " tests passed.");
