// Unit tests for the parts of the app that don't need the ArcGIS SDK. Run: node atlas/tests/run.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as csv from "../lib/csv.js";
import * as doc from "../lib/doc.js";
import * as catalog from "../lib/catalog.js";
import * as addData from "../kit/add-data.js";
import * as localSave from "../kit/local-save.js";
import * as basemaps from "../lib/basemaps.js";
import * as recent from "../lib/recent.js";
import { DEFAULT_STRINGS } from "../lib/strings.js";

let passed = 0;
const pending = [];
const test = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === "function") pending.push(r.then(() => { passed++; }, (e) => { console.error("FAIL:", name); throw e; })); else passed++; }
  catch (e) { console.error("FAIL:", name); throw e; }
};

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
  assert.deepEqual(wm.presentation.slides[0].visibleLayers, []);      // the only layer in the snapshot (sketches) was off
  JSON.stringify(wm);
});
const ROOT_KEYS = new Set(["applicationProperties", "authoringApp", "authoringAppVersion", "background", "baseMap", "bookmarks", "geotriggersInfo", "initialState",
  "mapFloorInfo", "mapIPSInfo", "mapRangeInfo", "operationalLayers", "parcelFabric", "presentation", "referenceScale", "spatialReference", "tables", "timeZone",
  "utilityNetworks", "version", "widgets"]);
const OP_KEYS = new Set(["attributeTableInfo", "blendMode", "capabilities", "charts", "customParameters", "definitionEditor", "disablePopup", "effect", "featureCollection",
  "featureCollectionType", "featureEffect", "formInfo", "id", "itemId", "layerDefinition", "layerType", "mode", "opacity", "popupInfo", "refreshInterval", "showLabels",
  "showLegend", "subtypeCode", "timeAnimation", "title", "url", "visibility", "visibilityTimeExtent", "visibleLayers"]);
const LAYERDEF_KEYS = new Set(["name", "type", "geometryType", "objectIdField", "fields", "drawingInfo", "extent", "capabilities", "definitionExpression", "maxScale", "minScale",
  "templates", "types", "typeIdField", "hasAttachments", "displayField", "spatialReference"]);
function trip() {
  const pt2 = { x: 1000, y: 2000, spatialReference: { wkid: 102100 } };
  const d = { graphics: [{ geometry: pt2, attributes: { uid: "p1", kind: "point", title: "Camp", description: "Night 1", imageUrl: "data:image/png;base64,iVBORw0KGgo=", color: "#0079c1", size: 12, rotation: 30 } }],
    layers: [{ id: "csv1", title: "Trees", geometryType: "point", objectIdField: "ObjectId", fields: [{ name: "ObjectId", type: "esriFieldTypeOID" }, { name: "H", type: "esriFieldTypeDouble" }],
      renderer: { type: "simple", symbol: { type: "esriSMS", style: "esriSMSCircle", color: [0, 0, 0, 255], size: 8 } }, popupInfo: { title: "Tree", fieldInfos: [{ fieldName: "H" }] },
      features: [{ geometry: pt2, attributes: { ObjectId: 1, H: 4.5 } }], visible: false, opacity: 0.6 }],
    bookmarks: [{ title: "Here", viewpoint: { center: [10, 20], zoom: 6 }, thumb: "data:image/jpeg;base64,/9j/4AAQ", layers: [{ id: "__sketch", visible: true }, { id: "__data_csv1", visible: false }, { id: "lyrA", visible: true }] },
      { title: "No layers", viewpoint: { center: [0, 0], zoom: 2 }, layers: [] }] };
  return doc.docToWebMap(d, { baseMap: { baseMapLayers: [{ id: "b", layerType: "ArcGISTiledMapServiceLayer", url: "https://services.arcgisonline.com/x/MapServer" }], title: "Topo" },
    sourceLayers: [{ id: "lyrA", title: "Rivers", layerType: "ArcGISFeatureLayer", url: "https://services.arcgis.com/a/FeatureServer/0", visibility: true }],
    portalLayers: [{ id: "__item_" + "a".repeat(32), title: "Biomes", layerType: "ArcGISFeatureLayer", itemId: "a".repeat(32), url: "https://services.arcgis.com/b/FeatureServer/0" }],
    extent: { xmin: 0, ymin: 0, xmax: 10, ymax: 10, spatialReference: { wkid: 102100 } }, scale: 50000, rotation: 15, appVersion: "1.2.0", sketchTitle: "My sketches", sketchVisible: true });
}
test("saved file is a web map with spec properties only", () => {
  const wm = trip();
  for (const k of Object.keys(wm)) assert.ok(ROOT_KEYS.has(k), "root key " + k);
  for (const k of ["authoringApp", "authoringAppVersion", "baseMap", "spatialReference", "version"]) assert.ok(wm[k], "required " + k);
  for (const op of wm.operationalLayers) {
    for (const k of Object.keys(op)) assert.ok(OP_KEYS.has(k), op.id + " key " + k);
    for (const l of (op.featureCollection && op.featureCollection.layers) || []) for (const k of Object.keys(l.layerDefinition)) assert.ok(LAYERDEF_KEYS.has(k), op.id + " layerDefinition key " + k);
  }
  assert.deepEqual(wm.initialState.viewpoint, { targetGeometry: { xmin: 0, ymin: 0, xmax: 10, ymax: 10, spatialReference: { wkid: 102100 } }, scale: 50000, rotation: 15 });
  assert.equal(wm.bookmarks[0].thumbnail.url.slice(0, 15), "data:image/jpeg");
  const pts = wm.operationalLayers.find((o) => o.id === "__sketch_points").featureCollection.layers[0];
  assert.equal(pts.popupInfo.mediaInfos[0].value.sourceURL, "{imageUrl}");
  assert.equal(wm.presentation.slides.length, 2);
  assert.deepEqual(wm.presentation.slides[0].visibleLayers.map((v) => v.id).sort(), ["__sketch_points", "lyrA"]);
  assert.equal(wm.presentation.slides[1].visibleLayers, undefined);   // no layer list: opening it leaves layers alone
});
test("reading a saved web map gives back everything, editable", () => {
  const r = doc.readWebMap(JSON.parse(JSON.stringify(trip())));
  assert.ok(r.ok); assert.equal(r.skipped, 0);
  assert.deepEqual(r.webmap.operationalLayers.map((o) => o.id), ["lyrA", "__item_" + "a".repeat(32)]);
  assert.equal(r.webmap.baseMap.title, "Topo");
  assert.equal(r.webmap.initialState.viewpoint.rotation, 15);
  assert.equal(r.graphics.length, 1); assert.equal(r.graphics[0].attributes.rotation, 30); assert.ok(r.graphics[0].attributes.imageUrl.startsWith("data:image/png"));
  assert.equal(r.layers.length, 1); assert.equal(r.layers[0].id, "csv1"); assert.equal(r.layers[0].visible, false); assert.equal(r.layers[0].opacity, 0.6);
  assert.equal(r.bookmarks.length, 2); assert.ok(r.bookmarks[0].thumb.startsWith("data:image/jpeg"));
  const st = Object.fromEntries(r.bookmarks[0].layers.map((x) => [x.id, x.visible]));
  assert.deepEqual(st, { lyrA: true, ["__item_" + "a".repeat(32)]: false, __data_csv1: false, __sketch: true });
  assert.deepEqual(r.bookmarks[1].layers, []);
  assert.ok(Math.abs(r.bookmarks[0].viewpoint.zoom - 6) < 1e-9);
});
test("web maps from files are checked before they load", () => {
  const bad = { operationalLayers: [
      { id: "ok", layerType: "ArcGISFeatureLayer", url: "https://services.arcgis.com/x/FeatureServer/0", popupInfo: { mediaInfos: [{ type: "image", value: { sourceURL: "http://tracker.example/p.gif" } }] } },
      { id: "plainhttp", layerType: "ArcGISMapServiceLayer", url: "http://insecure.example/MapServer" },
      { id: "script", layerType: "WMS", url: "javascript:alert(1)" },
      { id: "weird", layerType: "SomethingElse", url: "https://x.example" },
      { id: "fc", layerType: "ArcGISFeatureLayer", featureCollection: { layers: [{ layerDefinition: { drawingInfo: { renderer: { type: "simple", symbol: { type: "esriPMS", url: "http://x/y.png" } } } },
        featureSet: { features: Array.from({ length: 6000 }, (_, i) => ({ geometry: { x: i, y: i }, attributes: {} })) } }] } },
      { id: "grp", layerType: "GroupLayer", layers: [{ id: "in1", layerType: "ArcGISFeatureLayer", url: "https://a.example/0" }, { id: "in2", layerType: "KML", url: "ftp://b" }] }],
    baseMap: { baseMapLayers: [{ id: "bm", layerType: "WebTiledLayer", templateUrl: "http://tiles.example/{level}/{col}/{row}.png" }], title: "Bad" },
    __proto__x: 1 };
  const r = doc.readWebMap(bad);
  assert.ok(r.ok);
  assert.deepEqual(r.webmap.operationalLayers.map((o) => o.id), ["ok", "fc", "grp"]);
  assert.equal(r.webmap.operationalLayers[0].popupInfo.mediaInfos[0].value.sourceURL, undefined);
  const fc = r.webmap.operationalLayers[1].featureCollection.layers[0];
  assert.equal(fc.layerDefinition.drawingInfo.renderer.symbol.type, "esriSMS");   // picture from a plain-http address replaced
  assert.equal(fc.featureSet.features.length, doc.MAX_FEATURES);
  assert.deepEqual(r.webmap.operationalLayers[2].layers.map((o) => o.id), ["in1"]);
  assert.equal(r.webmap.baseMap, undefined);                                        // falls back to the app's basemap
  assert.equal(r.skipped, 3);
  assert.equal(doc.readWebMap({ type: doc.DOC_TYPE, graphics: [] }).ok, false);
  assert.equal(doc.readWebMap([1, 2]).ok, false);
});
test("ArcGIS Online items and older saves", () => {
  const item = { operationalLayers: [{ id: "x", layerType: "ArcGISMapServiceLayer", url: "http://legacy.example/MapServer" }], baseMap: { baseMapLayers: [], title: "T" } };
  assert.equal(doc.readWebMap(item, { trusted: true }).webmap.operationalLayers.length, 1);   // items load from ArcGIS Online, as in MapMaker
  const old = { operationalLayers: [], baseMap: { baseMapLayers: [], title: "T" }, bookmarks: [{ name: "A", extent: { xmin: 0, ymin: 0, xmax: 1, ymax: 1, spatialReference: { wkid: 102100 } } }],
    atlasBookmarks: [{ title: "A", viewpoint: { center: [1, 2], zoom: 5 }, layers: [{ id: "q", title: "Q", visible: false }] }] };
  const r = doc.readWebMap(old);
  assert.equal(r.bookmarks[0].layers[0].visible, false);
  const mapViewer = { operationalLayers: [], baseMap: { baseMapLayers: [], title: "T" }, bookmarks: [{ name: "MV", viewpoint: { targetGeometry: { xmin: 0, ymin: 0, xmax: 10, ymax: 10, spatialReference: { wkid: 102100 } } } }] };
  assert.ok(doc.readWebMap(mapViewer).bookmarks[0].viewpoint.extent);
});
// ---------- Open map topics ----------
const SCHEMA = { categorySchema: [{ title: "Categories", categories: [
  { title: "Lessons", categories: [{ title: "America 250" }, { title: "Earth Science" }] },
  { title: "Earth Science" },
  { title: "Human Geography", categories: [{ title: "Migration" }, { title: "Populated Places" }, { title: "Public Health" }] },
  { title: "Real-Time Data" }, { title: "" }, null
] }] };
const ITEMS = [
  { id: "a", title: "Light Pollution", snippet: "Night lights", tags: ["cities"], groupCategories: ["/Categories/Human Geography/Populated Places"] },
  { id: "b", title: "Trans-Atlantic Slave Trade", groupCategories: ["/Categories/Human Geography/Migration and Refugees", "/Categories/World History"] },
  { id: "c", title: "Volcanoes", description: "<p>Where <b>lava</b> flows</p>", groupCategories: ["/categories/earth science/"] },
  { id: "d", title: "Geografía de Panamá", groupCategories: [] },
  { id: "e", title: "America 250: Thirteen Colonies", groupCategories: ["/Categories/Lessons/America 250"] },
  { id: "f", title: "Earthquakes", groupCategories: ["/Categories/Earth Science", "/Categories/Human Geography/Public Health"] }
];
test("topic tree from the group's category schema", () => {
  const tree = catalog.buildTopicTree(SCHEMA);
  assert.deepEqual(tree.map((n) => n.title), ["Lessons", "Earth Science", "Human Geography", "Real-Time Data"]);
  const mig = catalog.findTopic(tree, "/categories/human geography/migration");
  assert.equal(mig.depth, 1); assert.equal(mig.parent.title, "Human Geography");
  assert.deepEqual(catalog.topicTrail(mig).map((n) => n.title), ["Human Geography", "Migration"]);
  assert.equal(catalog.flattenTopics(tree).length, 9);
  assert.deepEqual(catalog.buildTopicTree(null), []); assert.deepEqual(catalog.buildTopicTree({ categorySchema: [] }), []);
});
test("topic counts include sub-topics and ignore lookalike names", () => {
  const tree = catalog.buildTopicTree(SCHEMA), idx = catalog.indexItems(ITEMS);
  const { counts, other, total } = catalog.countTopics(tree, idx);
  assert.equal(total, 6);
  assert.equal(counts.get("/categories/human geography"), 3);           // a, b (assigned to a retired sub-topic), f
  assert.equal(counts.get("/categories/human geography/migration"), 0);  // "Migration and Refugees" is not "Migration"
  assert.equal(counts.get("/categories/earth science"), 2);               // c (trailing slash, lower case) and f
  assert.equal(counts.get("/categories/lessons/earth science"), 0);
  assert.equal(counts.get("/categories/lessons"), 1);
  assert.equal(other, 1);                                                 // d has no topic
});
test("filter by topic and accent-insensitive search", () => {
  const tree = catalog.buildTopicTree(SCHEMA), idx = catalog.indexItems(ITEMS);
  const ids = (key, text) => catalog.filterEntries(idx, tree, key, text, "en").map((e) => e.item.id);
  assert.deepEqual(ids(catalog.ALL, ""), ["e", "f", "d", "a", "b", "c"]);
  assert.deepEqual(ids("/categories/human geography", ""), ["f", "a", "b"]);
  assert.deepEqual(ids("/categories/human geography/populated places", ""), ["a"]);
  assert.deepEqual(ids(catalog.OTHER, ""), ["d"]);
  assert.deepEqual(ids(catalog.ALL, "geografia panama"), ["d"]);
  assert.deepEqual(ids(catalog.ALL, "lava"), ["c"]);                   // description text, tags stripped
  assert.deepEqual(ids(catalog.ALL, "cities"), ["a"]);                 // tags
  assert.deepEqual(ids("/categories/earth science", "light"), []);
  const ranked = catalog.filterEntries(catalog.indexItems([{ id: "x", title: "Rivers", snippet: "earth" }, { id: "y", title: "Earth layers" }]), tree, "", "earth").map((e) => e.item.id);
  assert.deepEqual(ranked, ["y", "x"]);                                 // title matches first
});
test("sub-topic chips", () => {
  const tree = catalog.buildTopicTree(SCHEMA), { counts } = catalog.countTopics(tree, catalog.indexItems(ITEMS));
  const hg = catalog.findTopic(tree, "/categories/human geography");
  assert.deepEqual(catalog.chipSet(hg, counts).chips.map((n) => n.title), ["Populated Places", "Public Health"]);
  const pp = catalog.findTopic(tree, "/categories/human geography/populated places");
  assert.equal(catalog.chipSet(pp, counts).parent, hg);
  assert.equal(catalog.chipSet(catalog.findTopic(tree, "/categories/real-time data"), counts), null);
  assert.equal(catalog.chipSet(hg, null).chips.length, 3);             // without counts (large groups) every sub-topic shows
});
test("page numbers", () => {
  assert.deepEqual(catalog.pageList(1, 1), [1]);
  assert.deepEqual(catalog.pageList(2, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(catalog.pageList(1, 12), [1, 2, 3, 4, 5, "…", 12]);
  assert.deepEqual(catalog.pageList(6, 12), [1, "…", 5, 6, 7, "…", 12]);
  assert.deepEqual(catalog.pageList(12, 12), [1, "…", 8, 9, 10, 11, 12]);
  assert.deepEqual(catalog.pageList(99, 3), [1, 2, 3]);
});
// ---------- Developer kit (kit/add-data.js, kit/local-save.js) with stand-in SDK classes
class FakeCollection { constructor(a) { this.a = a || []; } toArray() { return this.a.slice(); } find(f) { return this.a.find(f); } get length() { return this.a.length; } }
const fakeSdk = {
  FeatureLayer: class { constructor(p) { Object.assign(this, p); this.visible = true; this.opacity = 1; } },
  Graphic: class { constructor(p) { Object.assign(this, p); } static fromJSON(j) { return new this(j); } },
  Field: { fromJSON: (j) => j }, LabelClass: { fromJSON: (j) => j }, rendererJsonUtils: { fromJSON: (j) => ({ ...j, autocast: true }) }
};
const TREES = "Site;Latitud;Longitud;Especie;Altura\nA;8,98;-79,52;Roble;12,5\nB;9,01;-79,50;Ceiba;7\nC;9,02;-79,49;Roble;9\n";
test("kit: CSV to a client-side layer", () => {
  const d = addData.readCsvData(TREES, "arboles.csv");
  assert.ok(d.ok); assert.equal(d.features.length, 3); assert.deepEqual(d.categorical, ["Site", "Especie"]); assert.deepEqual(d.numeric, ["Altura"]);
  assert.equal(addData.readCsvData("Name,North,East\nA,1,2\n", "x.csv").needsColumns, true);
  const forced = addData.readCsvData("Name,North,East\nA,1,2\n", "x.csv", { latIdx: 1, lonIdx: 2 });
  assert.ok(forced.ok);
  assert.equal(addData.readCsvData("", "e.csv").code, "csvEmpty");
  assert.deepEqual(addData.availableStyles(d).map((x) => x.id), ["simple", "categorical", "graduated", "categorical_size"]);
  const auto = addData.layerDefFromData(d, { id: "t1" });
  assert.equal(auto.renderer.type, "uniqueValue"); assert.equal(auto.renderer.visualVariables[0].field, "Altura");   // type and size
  assert.equal(auto.title, "arboles");
  const lab = addData.layerDefFromData(d, { id: "t2", style: "simple", label: "Site", colorRgb: [10, 20, 30] });
  assert.equal(lab.renderer.symbol.color.slice(0, 3).join(), "10,20,30"); assert.equal(lab.labelingInfo[0].labelExpressionInfo.expression, "$feature.Site");
  assert.throws(() => addData.layerDefFromData(d, { style: "pie_chart" }));
  const layer = addData.createDataLayer(auto, fakeSdk);
  assert.equal(layer.id, "__data_t1"); assert.equal(layer.source.length, 3); assert.equal(layer.objectIdField, "ObjectId"); assert.ok(layer.renderer.autocast);
  layer.visible = false; layer.opacity = 0.5;
  const back = addData.dataLayerDef(layer);
  assert.equal(back.visible, false); assert.equal(back.opacity, 0.5); assert.equal(back.features.length, 3);
});
test("kit: sketches from symbols, and back to graphics", () => {
  const pt = { type: "point", x: 1, y: 2, spatialReference: { wkid: 102100 } };
  const a = localSave.sketchAttributes({ geometry: pt, attributes: { title: "Camp" }, symbol: { type: "simple-marker", color: { toHex: () => "#d4572a" }, size: 14, angle: 30 } });
  assert.deepEqual([a.kind, a.color, a.size, a.rotation, a.title], ["point", "#d4572a", 14, 30, "Camp"]);
  const tx = localSave.sketchAttributes({ geometry: pt, attributes: {}, symbol: { type: "text", text: "River", color: [0, 0, 255, 1], font: { size: 18 } } });
  assert.deepEqual([tx.kind, tx.title, tx.color, tx.size], ["text", "River", "#0000ff", 18]);
  const ln = localSave.sketchAttributes({ geometry: { type: "polyline", paths: [[[0, 0], [1, 1]]] }, attributes: {}, symbol: { type: "simple-line", color: [255, 0, 0], width: 2 } });
  assert.deepEqual([ln.kind, ln.size], ["polyline", 8]);
  const g = localSave.sketchGraphic({ geometry: { paths: [[[0, 0], [1, 1]]], spatialReference: { wkid: 102100 } }, attributes: { kind: "polyline", color: "#1a7f37", size: 8, title: "Route" } }, fakeSdk.Graphic);
  assert.equal(g.symbol.type, "simple-line"); assert.equal(g.symbol.width, 2); assert.equal(g.popupTemplate.title, "{title}");
});
test("kit: layers from the collection as operational layers", () => {
  const f = localSave.layerToOperationalJson({ id: "__item_" + "a".repeat(32), title: "Rivers", type: "feature", url: "https://s/FeatureServer", layerId: 3, portalItem: { id: "a".repeat(32) }, visible: false, opacity: 0.4 });
  assert.deepEqual(f, { id: "__item_" + "a".repeat(32), title: "Rivers", visibility: false, opacity: 0.4, layerType: "ArcGISFeatureLayer", itemId: "a".repeat(32), url: "https://s/FeatureServer/3" });
  assert.equal(localSave.layerToOperationalJson({ id: "v", type: "vector-tile", url: "https://s/VectorTileServer", visible: true }).styleUrl, "https://s/VectorTileServer/resources/styles/root.json");
  assert.equal(localSave.layerToOperationalJson({ id: "k", type: "kml", url: "https://s/a.kml", visible: true }).layerType, "KML");
  assert.equal(localSave.layerToOperationalJson({ id: "x", type: "graphics", visible: true }), null);
  const map = { layers: new FakeCollection([{ id: "rivers", visible: false, opacity: 0.7 }]) };
  const src = { operationalLayers: [{ id: "rivers", layerType: "ArcGISFeatureLayer", url: "https://r/0", visibility: true }, { id: "__sketch_points" }, { id: "__item_x" }] };
  assert.deepEqual(localSave.sourceLayersJson(map, src), [{ id: "rivers", layerType: "ArcGISFeatureLayer", url: "https://r/0", visibility: false, opacity: 0.7 }]);
});
test("kit: the whole map to a web map and back", async () => {
  const pt = { type: "point", x: 1, y: 2, spatialReference: { wkid: 102100 } };
  const g = { geometry: { ...pt, toJSON: () => ({ x: 1, y: 2, spatialReference: { wkid: 102100 } }) }, attributes: { title: "Camp" }, symbol: { type: "simple-marker", color: [212, 87, 42, 1], size: 12 } };
  const data = addData.createDataLayer(addData.layerDefFromData(addData.readCsvData(TREES, "trees.csv"), { id: "t9" }), fakeSdk);
  const extent = { xmin: 0, ymin: 0, xmax: 10, ymax: 10, spatialReference: { wkid: 102100 } };
  const view = { type: "2d", scale: 50000, rotation: 0, extent: { clone: () => ({ toJSON: () => extent }) },
    map: { basemap: { portalItem: { id: "b".repeat(32) } }, layers: new FakeCollection([]) } };
  const { json, skippedLayers } = await localSave.mapToWebMapJson({ view, sourceJson: null, sketchLayer: { visible: true, graphics: new FakeCollection([g]) },
    dataLayers: [data], addedLayers: [{ id: "odd", type: "graphics" }], fetchItemData: async () => ({ baseMap: { baseMapLayers: [{ id: "t", layerType: "ArcGISTiledMapServiceLayer", url: "https://b/MapServer" }], title: "Topo" } }),
    appName: "Atlas", appVersion: "9.9" });
  assert.equal(skippedLayers, 1);
  assert.deepEqual([json.authoringApp, json.authoringAppVersion, json.baseMap.title, json.initialState.viewpoint.scale], ["Atlas", "9.9", "Topo", 50000]);
  assert.deepEqual(json.operationalLayers.map((o) => o.id), ["__data_t9", "__sketch_points"]);
  const r = localSave.readWebMap(JSON.parse(JSON.stringify(json)));
  assert.ok(r.ok); assert.equal(r.layers[0].features.length, 3); assert.equal(r.graphics[0].attributes.color, "#d4572a");
  assert.equal(localSave.titleFromFileName("Field_trip-2.amap"), "Field trip 2");
  assert.equal(localSave.titleFromFileName("Field_trip-2.mmap"), "Field trip 2");   // files from before 1.7
  assert.equal(localSave.FILE_EXTENSION, ".amap");
});
// ---------- Basemaps (MapMaker's card grid) ----------
// The live basemap group (Basemaps for the Schools Living Atlas, October 2026), in its own order: date added, newest first.
const BASEMAP_GROUP = [
  { id: "46c8388da4c6485bb713da53d274deec", type: "Web Map", title: "OpenStreetMap Style", thumbnail: "thumbnail/ago_downloaded.png" },
  { id: "048c8a152b764f61b626feff253b763e", type: "Web Map", title: "Ocean", thumbnail: "thumbnail/ago_downloaded.png" },
  { id: "b7e903f67356416195cf1d91a2a682f2", type: "Web Scene", title: "3D Buildings", thumbnail: "thumbnail/ago_downloaded.png" },
  { id: "0a5fc59c96e64f93929f8fd1b82d985b", type: "Web Map", title: "Black and White Outline", thumbnail: "thumbnail/thumbnail1709256941698.png" },
  { id: "0d0c6a901f6042acaf8823f7d5ac8765", type: "Web Map", title: "Imagery (no labels) ", thumbnail: "thumbnail/ago_downloaded.png" },
  { id: "a82ff7ce1c3a493f9d82aa89f5a1ddcf", type: "Web Map", title: "National Geographic Style", thumbnail: "thumbnail/ago_downloaded.png" },
  { id: "ffffffffffffffffffffffffffffffff", type: "Web Mapping Application", title: "Not a basemap" },
  { id: "048c8a152b764f61b626feff253b763e", type: "Web Map", title: "Ocean (again)" }];
test("basemaps: 2D shows the group's web maps in its order; 3D puts 3D basemaps first", () => {
  assert.deepEqual(basemaps.basemapItems(BASEMAP_GROUP, "2d").map((i) => i.title.trim()),
    ["OpenStreetMap Style", "Ocean", "Black and White Outline", "Imagery (no labels)", "National Geographic Style"]);
  assert.deepEqual(basemaps.basemapItems(BASEMAP_GROUP, "3d").map((i) => i.title.trim()).slice(0, 3), ["3D Buildings", "OpenStreetMap Style", "Ocean"]);
  assert.deepEqual(basemaps.basemapItems(null, "2d"), []);
});
test("basemaps: the group's sort, thumbnails, which card is selected, arrow keys", () => {
  assert.deepEqual(basemaps.groupSort({ sortField: "added", sortOrder: "desc" }), { sortField: "added", sortOrder: "desc" });
  assert.deepEqual(basemaps.groupSort({ sortField: "TITLE", sortOrder: "asc" }), { sortField: "title", sortOrder: "asc" });
  assert.deepEqual(basemaps.groupSort({ sortField: "nonsense" }), {});
  assert.equal(basemaps.thumbnailUrl("https://www.arcgis.com/", BASEMAP_GROUP[3], 400),
    "https://www.arcgis.com/sharing/rest/content/items/0a5fc59c96e64f93929f8fd1b82d985b/info/thumbnail/thumbnail1709256941698.png?w=400");
  assert.equal(basemaps.thumbnailUrl("https://www.arcgis.com", { id: "a".repeat(32), thumbnail: "thumbnail/my pic.png" }), "https://www.arcgis.com/sharing/rest/content/items/" + "a".repeat(32) + "/info/thumbnail/my%20pic.png");
  for (const bad of ["https://evil.example/x.png", "thumbnail/../../x", "../thumbnail/x.png", "thumbnail/x.png?y=1", ""]) assert.equal(basemaps.thumbnailUrl("https://www.arcgis.com", { id: "a".repeat(32), thumbnail: bad }), "", bad);
  const two = basemaps.basemapItems(BASEMAP_GROUP, "2d");
  assert.equal(basemaps.selectedId(two, { itemId: "048c8a152b764f61b626feff253b763e", title: "" }), "048c8a152b764f61b626feff253b763e");
  assert.equal(basemaps.selectedId(two, { itemId: null, title: "imagery (no labels)" }), "0d0c6a901f6042acaf8823f7d5ac8765");   // a basemap from inside a web map
  assert.equal(basemaps.selectedId(two, { itemId: "b7e903f67356416195cf1d91a2a682f2", title: "3D Buildings" }), null);   // 3D basemap, 2D list
  assert.equal(basemaps.selectedId(two, null), null);
  const inside = new Map([["048c8a152b764f61b626feff253b763e", "Oceans"]]);   // the title of the basemap inside the Ocean item
  assert.equal(basemaps.needsDataTitles(two, { itemId: null, title: "Oceans" }), true);
  assert.equal(basemaps.selectedId(two, { itemId: null, title: "Oceans" }, inside), "048c8a152b764f61b626feff253b763e");
  assert.equal(basemaps.needsDataTitles(two, { itemId: null, title: "Ocean" }), false);   // the card's own name already matches
  assert.equal(basemaps.needsDataTitles(two, { itemId: "048c8a152b764f61b626feff253b763e", title: "Ocean" }), false);
  assert.equal(basemaps.gridMove(0, 5, 2, "ArrowRight"), 1); assert.equal(basemaps.gridMove(1, 5, 2, "ArrowDown"), 3);
  assert.equal(basemaps.gridMove(3, 5, 2, "ArrowDown"), null); assert.equal(basemaps.gridMove(0, 5, 2, "ArrowLeft"), null);
  assert.equal(basemaps.gridMove(2, 5, 2, "End"), 4); assert.equal(basemaps.gridMove(3, 5, 2, "Home"), 0); assert.equal(basemaps.gridMove(1, 5, 2, "a"), null);
});

// ---------- Saved maps on this device ----------
test("saved maps: entries keep a handle or a copy, a checked picture, newest first", () => {
  const pic = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
  const h = { name: "trip.mmap" };
  const a = recent.makeEntry({ scope: "mapmaker", title: " Trip ", fileName: "trip.mmap", savedAt: "2026-10-26T10:00:00.000Z", thumb: pic, handle: h, json: "{}" });
  assert.equal(a.title, "Trip"); assert.equal(a.handle, h); assert.equal(a.json, null); assert.equal(a.thumb, pic); assert.ok(a.id);
  const b = recent.makeEntry({ scope: "mapmaker", fileName: "b.mmap", savedAt: "2026-10-26T11:00:00.000Z", thumb: "javascript:alert(1)", json: "{\"x\":1}" });
  assert.equal(b.thumb, null); assert.equal(b.handle, null); assert.equal(b.json, "{\"x\":1}");
  assert.equal(recent.makeEntry({ thumb: "data:image/svg+xml;base64,PHN2Zz4=" }).thumb, null);   // only bitmap pictures
  assert.equal(recent.makeEntry({ thumb: "data:image/png;base64,AAA=');background:url(x" }).thumb, null);
  const c = recent.makeEntry({ scope: "mapmaker", fileName: "c.mmap", savedAt: "2026-10-25T09:00:00.000Z", json: "{}" });
  assert.deepEqual(recent.sortEntries([a, c, b]).map((e) => e.fileName), ["b.mmap", "trip.mmap", "c.mmap"]);
  const { keep, drop } = recent.pruneEntries([a, b, c], 2);
  assert.deepEqual(keep.map((e) => e.fileName), ["b.mmap", "trip.mmap"]); assert.deepEqual(drop.map((e) => e.fileName), ["c.mmap"]);
});
test("saved maps: a new save may replace an entry with the same file name, kind and app", () => {
  const list = [recent.makeEntry({ scope: "mapmaker", fileName: "a.mmap", handle: { name: "a.mmap" } }), recent.makeEntry({ scope: "mapmaker", fileName: "b.mmap", json: "{}" }),
    recent.makeEntry({ scope: "default", fileName: "b.mmap", json: "{}" }), recent.makeEntry({ scope: "mapmaker", fileName: "a.mmap", json: "{}" })];
  assert.deepEqual(recent.candidates(list, recent.makeEntry({ scope: "mapmaker", fileName: "a.mmap", handle: {} })), [list[0]]);   // then isSameEntry decides
  assert.deepEqual(recent.candidates(list, recent.makeEntry({ scope: "mapmaker", fileName: "b.mmap", json: "{}" })), [list[1]]);  // a download: same name
  assert.deepEqual(recent.candidates(list, recent.makeEntry({ scope: "mapmaker", fileName: "a.mmap", json: "{}" })), [list[3]]);
  assert.deepEqual(recent.candidates(list, recent.makeEntry({ scope: "es", fileName: "b.mmap", json: "{}" })), []);
  assert.equal(list[0].hasHandle, true); assert.equal(list[1].hasHandle, false);
});
// ---------- Changing a spreadsheet layer's style after it's added ----------
test("style read back from a layer definition, for every style", () => {
  const text = "Site,Latitude,Longitude,Species,Height,Width,Depth\nA,51.5,-0.12,Oak,12,3,1\nB,51.6,-0.11,Ash,9,2,4\nC,51.55,-0.1,Oak,15,5,2\nD,51.52,-0.13,Birch,7,1,3\n";
  const parsed = csv.readCsv(text);
  for (const id of ["simple", "categorical", "graduated", "numeric_color_size", "categorical_size", "pie_chart"]) {
    const st = csv.buildLayerData("trees.csv", parsed, parsed.latIdx, parsed.lonIdx);
    st.symbolChoices = { shape: "esriSMSDiamond", color: [26, 127, 55], size: 16, ramp: "green" };
    st.style = csv.DATA_STYLES.find((x) => x.id === id);
    st.fieldChoices = { ...csv.pickAutoFields(st.style, st), label: "Site" };
    if (id === "numeric_color_size") st.fieldChoices = { color: "Width", size: "Height", label: "Site" };
    const def = JSON.parse(JSON.stringify(csv.buildLayerDef(st, "abc", "Trees")));   // as saved in a file
    const back = csv.stateFromLayerDef(def);
    assert.ok(back.ok, id);
    assert.equal(back.style.id, id, id);
    assert.deepEqual(back.fieldChoices, st.fieldChoices, id);
    assert.deepEqual(back.coordNames, ["Latitude", "Longitude"], id);
    assert.ok(!back.numeric.includes("Latitude") && back.numeric.includes("Height") && back.categorical.includes("Species"), id);
    assert.equal(back.symbolChoices.size, 16, id + " size");
    if (id !== "pie_chart") assert.equal(back.symbolChoices.shape, "esriSMSDiamond", id);
    if (id === "simple" || id === "graduated") assert.deepEqual(back.symbolChoices.color, [26, 127, 55], id);
    if (id === "numeric_color_size") assert.equal(back.symbolChoices.ramp, "green");
    // and building it again gives the same renderer
    assert.deepEqual(JSON.parse(JSON.stringify(csv.buildLayerDef(back, "abc", "Trees").renderer)), def.renderer, id + " renderer");
  }
});
test("style read back falls back when the saved style no longer fits, and refuses junk", () => {
  const parsed = csv.readCsv("Site,Latitude,Longitude,Species\nA,51.5,-0.12,Oak\nB,51.6,-0.11,Ash\n");
  const st = csv.buildLayerData("t.csv", parsed, parsed.latIdx, parsed.lonIdx);
  st.symbolChoices = { shape: "esriSMSCircle", color: [0, 121, 193], size: 12, ramp: "blue" };
  st.style = csv.DATA_STYLES.find((x) => x.id === "categorical"); st.fieldChoices = { color: "Species", size: null, label: null };
  const def = JSON.parse(JSON.stringify(csv.buildLayerDef(st, "x", "T")));
  def.renderer.field1 = "Gone";
  const fb = csv.stateFromLayerDef(def);   // the automatic choice instead of a column that's gone
  assert.ok(fb.ok && fb.categorical.includes(fb.fieldChoices.color) && fb.fieldChoices.color !== "Gone");
  assert.equal(csv.stateFromLayerDef(null).ok, false);
  assert.equal(csv.stateFromLayerDef({ fields: [], features: [] }).ok, false);
});
test("every config translates only known strings", () => {
  for (const f of ["default", "mapmaker", "example-es"]) {
    const c = JSON.parse(readFileSync(new URL("../config/" + f + ".json", import.meta.url)));
    for (const k of Object.keys(c.strings || {})) assert.ok(k in DEFAULT_STRINGS, f + ": unknown string " + k);
    for (const k of ["contentGroup", "basemapGroup", "defaultBasemap"]) assert.match(c[k], /^[0-9a-f]{32}$/);
  }
});
await Promise.all(pending);
console.log("All " + passed + " tests passed.");
