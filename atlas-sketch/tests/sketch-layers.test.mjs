// More than one sketch layer in a saved map (format 3.6): written, ordered and read back.  node sketch-layers.test.mjs
import { docToWebMap, readWebMap, docToWebScene, readWebScene, sanitizeDoc, DOC_TYPE, DOC_VERSION, sketchLayersIn, SKETCH_LAYER_PROP, isSketchKey, sketchLayerId } from "../lib/doc.js";
let n = 0, bad = 0;
const ok = (c, m, got) => { n++; if (!c) { bad++; console.log("  FAIL " + m + (got === undefined ? "" : " — got " + JSON.stringify(got))); } else console.log("  ok   " + m); };
const SR = { wkid: 102100 };
const pt = (x, title, layer) => { const g = { geometry: { x, y: 0, spatialReference: SR }, attributes: { uid: "u" + x, kind: "point", title, description: "", color: "#0079c1", size: 12 } }; if (layer) g.layer = layer; return g; };
const line = (x, layer) => { const g = { geometry: { paths: [[[x, 0], [x + 10, 10]]], spatialReference: SR }, attributes: { uid: "l" + x, kind: "line", title: "L", description: "", color: "#0079c1", size: 3 } }; if (layer) g.layer = layer; return g; };
const foreign = (id) => ({ id, title: id, layerType: "ArcGISFeatureLayer", url: "https://services.arcgis.com/x/arcgis/rest/services/" + id + "/FeatureServer/0" });
const ctx = (order) => ({ baseMap: { baseMapLayers: [], title: "B" }, sourceLayers: [foreign("roads"), foreign("towns")], portalLayers: [], sketchTitle: "My sketches", sketchVisible: true, sketchOpacity: 1, order });
const ids = (wm) => wm.operationalLayers.map((o) => o.id);

// one sketch layer: exactly as before 3.6
let wm = docToWebMap({ graphics: [pt(1, "A"), line(2)], layers: [], bookmarks: [] }, ctx(["roads", "towns"]));
ok(JSON.stringify(ids(wm)) === '["roads","towns","__sketch_points","__sketch_lines"]', "one sketch layer is saved as before, on top", ids(wm));
ok(wm.operationalLayers.every((o) => !(SKETCH_LAYER_PROP in o)), "with no mark of this app's on it");

// two sketch layers, one of them moved below a layer of the map
const doc = { graphics: [pt(1, "A"), line(2), pt(3, "R1", "Lriver1"), line(4, "Lriver1")], layers: [], bookmarks: [],
  sketchLayers: [{ key: "", title: null, visible: true, opacity: 1 }, { key: "Lriver1", title: "Rivers", visible: false, opacity: 0.5 }] };
wm = docToWebMap(doc, ctx(["roads", "__sketch_Lriver1", "towns", "__sketch"]));
ok(JSON.stringify(ids(wm)) === '["roads","__sketch_Lriver1_points","__sketch_Lriver1_lines","towns","__sketch_points","__sketch_lines"]', "each sketch layer is saved in its place in the drawing order", ids(wm));
const rv = wm.operationalLayers.filter((o) => o.id.startsWith("__sketch_Lriver1"));
ok(rv.every((o) => o[SKETCH_LAYER_PROP].id === "Lriver1" && o[SKETCH_LAYER_PROP].title === "Rivers" && o.visibility === false && o.opacity === 0.5) && rv[0].title === "Rivers" && rv[1].title === "Rivers (lines)", "a further layer's parts carry its key, name, visibility and transparency");
let r = readWebMap(wm);
ok(r.ok && JSON.stringify(r.order) === '["roads","__sketch_Lriver1","towns","__sketch"]', "read back: the layer order, each sketch layer once", r.order);
ok(JSON.stringify(r.sketchLayers) === '[{"key":"Lriver1","title":"Rivers","visible":false,"opacity":0.5},{"key":"","title":null,"visible":true,"opacity":1}]', "the sketch layers and their settings", r.sketchLayers);
ok(r.graphics.length === 4 && r.graphics.filter((g) => g.layer === "Lriver1").map((g) => g.attributes.uid).sort().join() === "l4,u3" && r.graphics.filter((g) => !g.layer).length === 2, "and each sketch on the layer it was on");
ok(r.sketchVisible === true && r.sketchOpacity === 1, "the first layer's own settings are still given as before");

// an order that doesn't name a sketch layer: it goes on top; a renamed first layer keeps its name
wm = docToWebMap({ ...doc, sketchLayers: [{ key: "", title: "Field notes", visible: true, opacity: 1 }, doc.sketchLayers[1]] }, ctx(["roads", "towns"]));
ok(ids(wm).slice(0, 2).join() === "roads,towns" && ids(wm).length === 6, "sketch layers the order doesn't name are saved on top");
ok(readWebMap(wm).sketchLayers.find((m) => m.key === "").title === "Field notes", "a first layer that was renamed keeps its name");

// an empty further layer is kept; an empty first layer is not written
wm = docToWebMap({ graphics: [], layers: [], bookmarks: [], sketchLayers: [{ key: "", title: null, visible: true, opacity: 1 }, { key: "Lempty1", title: "Plan", visible: true, opacity: 1 }] }, ctx(["roads", "towns"]));
ok(JSON.stringify(ids(wm)) === '["roads","towns","__sketch_Lempty1_points"]' && wm.operationalLayers[2].featureCollection.layers[0].featureSet.features.length === 0, "a further layer with nothing on it is kept, empty", ids(wm));
r = readWebMap(wm); ok(r.sketchLayers.length === 1 && r.sketchLayers[0].title === "Plan" && r.graphics.length === 0, "and comes back");

// sketches on a layer the document doesn't list go to the first layer; a made-up key is not a key
wm = docToWebMap({ graphics: [pt(1, "A", "Lgone11"), pt(2, "B", "../x")], layers: [], bookmarks: [] }, ctx([]));
ok(ids(wm).join() === "roads,towns,__sketch_points" && wm.operationalLayers[2].featureCollection.layers[0].featureSet.features.length === 2, "sketches of a layer that isn't listed are kept, on the first layer");
ok(isSketchKey("Lab12cd") && !isSketchKey("points") && !isSketchKey("L") && !isSketchKey("Lab-12") && sketchLayerId("") === "__sketch" && sketchLayerId("Lab12cd") === "__sketch_Lab12cd", "keys are L and 4 to 12 letters or digits");
const tampered = JSON.parse(JSON.stringify(docToWebMap(doc, ctx([])))); tampered.operationalLayers.forEach((o) => { if (o[SKETCH_LAYER_PROP]) o[SKETCH_LAYER_PROP].id = "<script>"; });
r = readWebMap(tampered); ok(r.sketchLayers.length === 1 && r.sketchLayers[0].key === "" && r.graphics.every((g) => !g.layer), "a mark with a bad key is read as the first layer");

// bookmarks: each sketch layer on or off
const bdoc = { ...doc, bookmarks: [{ title: "B1", viewpoint: { center: [0, 0], zoom: 5 }, layers: [{ id: "roads", title: "", visible: true }, { id: "towns", title: "", visible: false }, { id: "__sketch", title: "", visible: false }, { id: "__sketch_Lriver1", title: "", visible: true }] },
  { title: "Old", viewpoint: { center: [0, 0], zoom: 5 }, layers: [{ id: "roads", title: "", visible: true }, { id: "__sketch", title: "", visible: true }] }] };
wm = docToWebMap(bdoc, { ...ctx(["roads", "towns", "__sketch", "__sketch_Lriver1"]), extent: { xmin: 0, ymin: 0, xmax: 1, ymax: 1, spatialReference: SR } });
const vis = (i) => wm.presentation.slides[i].visibleLayers.map((v) => v.id).join();
ok(vis(0) === "roads,__sketch_Lriver1_points,__sketch_Lriver1_lines", "a bookmark lists the sketch layers that were on", vis(0));
ok(vis(1) === "roads,__sketch_points,__sketch_lines,__sketch_Lriver1_points,__sketch_Lriver1_lines", "a bookmark made before a sketch layer existed leaves that layer on", vis(1));
r = readWebMap(wm);
const rec = (i, id) => r.bookmarks[i].layers.find((x) => x.id === id);
ok(rec(0, "__sketch").visible === false && rec(0, "__sketch_Lriver1").visible === true && rec(0, "towns").visible === false, "read back per sketch layer");

// the app's own document (recent maps) keeps layers and order; a 3D map too
const c = sanitizeDoc({ type: DOC_TYPE, version: DOC_VERSION, title: "t", graphics: doc.graphics, layers: [], sketchLayers: doc.sketchLayers.concat([{ key: "bad key" }, { key: "Lriver1" }]), order: ["roads", 5, "__sketch"] });
ok(c.ok && c.doc.sketchLayers.length === 2 && c.doc.graphics.filter((g) => g.layer === "Lriver1").length === 2 && c.doc.order.join() === "roads,__sketch", "the app's own document keeps sketch layers, each sketch's layer and the order", c.ok ? [c.doc.sketchLayers, c.doc.order] : c);
const ws = docToWebScene(bdoc, { ...ctx(["roads", "__sketch_Lriver1", "towns", "__sketch"]), camera: { position: { x: 0, y: 0, z: 1000, spatialReference: { wkid: 4326 } }, heading: 0, tilt: 40 }, scene: {} });
ok(ws.operationalLayers.map((o) => o.id).join() === "roads,__sketch_Lriver1_points,__sketch_Lriver1_lines,towns,__sketch_points,__sketch_lines", "a 3D map is saved the same way");
const rs = readWebScene(ws);
ok(rs.ok && rs.sketchLayers.length === 2 && rs.order.join() === "roads,__sketch_Lriver1,towns,__sketch" && rs.bookmarks[0].layers.find((x) => x.id === "__sketch_Lriver1").visible === true && rs.bookmarks[0].layers.find((x) => x.id === "__sketch").visible === false, "and read back, bookmarks included");
ok(sketchLayersIn([]).length === 0, "a map with no sketches has no sketch layers");
console.log(bad ? `${bad} of ${n} FAILED` : `All ${n} checks passed.`); process.exit(bad ? 1 : 0);
