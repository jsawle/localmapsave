// Web scene files (saved-map format 3.0). Run: node atlas-sketch/tests/scenes.test.mjs
import { docToWebScene, readWebScene, looksLikeWebScene, looksLikeWebMap, docToWebMap, readWebMap, WEBSCENE_SPEC_VERSION, WEBMAP_WRITER_VERSION } from "../lib/doc.js";
let n = 0, bad = 0;
const ok = (c, msg, got) => { n++; if (!c) { bad++; console.log("  FAIL " + msg + (got !== undefined ? " — got " + JSON.stringify(got) : "")); } else console.log("  ok   " + msg); };

const source = {
  operationalLayers: [
    { id: "bld", layerType: "ArcGISSceneServiceLayer", title: "Buildings", url: "https://tiles.arcgis.com/tiles/x/arcgis/rest/services/B/SceneServer/layers/0", visibility: true },
    { id: "pts", layerType: "ArcGISFeatureLayer", title: "Quakes", url: "https://services.arcgis.com/x/arcgis/rest/services/Q/FeatureServer/0", visibility: false }
  ],
  baseMap: { title: "Imagery", baseMapLayers: [{ id: "img", layerType: "ArcGISTiledMapServiceLayer", url: "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer" }] },
  ground: { layers: [{ id: "elev", layerType: "ArcGISTiledElevationServiceLayer", title: "Terrain3D", url: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer" }], transparency: 0 },
  initialState: { environment: { lighting: { datetime: 1458072640000, directShadows: true }, weather: { type: "sunny" } } },
  spatialReference: { wkid: 102100, latestWkid: 3857 }, viewingMode: "global", version: "1.39", heightModelInfo: { heightModel: "gravity_related_height", heightUnit: "meter" }
};
const camera = { position: { x: -13046000, y: 4036000, z: 1500, spatialReference: { wkid: 102100 } }, heading: 30, tilt: 65, fov: 55 };
const doc = {
  graphics: [{ geometry: { x: -13046000, y: 4036000, spatialReference: { wkid: 102100 } }, attributes: { kind: "point", color: "#e4002b" } }],
  layers: [],
  bookmarks: [
    { title: "Downtown", viewpoint: { center: [-117.2, 34.05], zoom: 10 }, camera, layers: [{ id: "bld", title: "", visible: true }, { id: "pts", title: "", visible: false }], thumb: null },
    { title: "No camera", viewpoint: { center: [10, 50], zoom: 6 }, layers: [], thumb: null }
  ]
};
const ws = docToWebScene(doc, { baseMap: source.baseMap, sourceLayers: source.operationalLayers, portalLayers: [], appVersion: "5.0.0-test", sketchTitle: "Sketch", sketchVisible: true, camera, scene: source });

ok(WEBMAP_WRITER_VERSION === "3.1", "the saved-map writer is 3.1", WEBMAP_WRITER_VERSION);
ok(looksLikeWebScene(ws), "a saved scene is recognised as a web scene");
ok(!looksLikeWebScene(docToWebMap(doc, { baseMap: source.baseMap, sourceLayers: [], portalLayers: [] })), "a saved web map is not");
ok(ws.version === WEBSCENE_SPEC_VERSION && ws.viewingMode === "global" && ws.ground.layers[0].id === "elev", "it has the spec version, the kind of scene and the source's ground");
ok(["ground", "operationalLayers", "spatialReference", "version", "viewingMode"].every((k) => k in ws), "every property the specification requires is there");
const allowed = new Set(["applicationProperties", "authoringApp", "authoringAppVersion", "baseMap", "clippingArea", "ground", "heightModelInfo", "initialState", "mapFloorInfo", "mapRangeInfo", "operationalLayers", "presentation", "spatialReference", "tables", "transportationNetworks", "version", "viewingMode", "widgets"]);
ok(Object.keys(ws).every((k) => allowed.has(k)), "and nothing the specification doesn't define", Object.keys(ws).filter((k) => !allowed.has(k)));
ok(!("bookmarks" in ws) && !("extent" in (ws.initialState || {})), "no web map bookmarks or 2D extent");
ok(ws.initialState.viewpoint.camera.tilt === 65 && ws.initialState.viewpoint.camera.position.z === 1500, "the camera is the initial view: tilt and height kept");
ok(ws.initialState.environment.weather.type === "sunny" && ws.heightModelInfo.heightUnit === "meter", "lighting, weather and height model come from the opened scene");
ok(ws.presentation.slides.length === 2 && ws.presentation.slides[0].title.text === "Downtown" && ws.presentation.slides[0].viewpoint.camera.heading === 30, "bookmarks are slides, each with its camera");
ok(JSON.stringify(ws.presentation.slides[0].visibleLayers) === '[{"id":"bld"}]', "a slide lists the layers that were on", ws.presentation.slides[0].visibleLayers);
ok(ws.presentation.slides[1].viewpoint.camera.position.spatialReference.wkid === 4326 && ws.presentation.slides[1].viewpoint.camera.tilt === 0, "a bookmark with no camera looks straight down at its place");
ok(ws.operationalLayers.some((o) => String(o.id).startsWith("__sketch_") && o.featureCollection), "the sketch is a feature collection layer in the scene");
ok(ws.operationalLayers.slice(0, 2).map((o) => o.id).join() === "bld,pts", "the scene's own layers are kept, in order");

const back = readWebScene(JSON.parse(JSON.stringify(ws)));
ok(back.ok && back.webscene && !back.webmap, "the file reads back as a scene");
ok(back.graphics.length === 1 && back.webscene.operationalLayers.length === 2, "the sketch comes back editable and is not left in the scene's layers", [back.graphics.length, back.webscene.operationalLayers.length]);
ok(back.camera.tilt === 65 && back.webscene.initialState.viewpoint.camera.position.z === 1500, "the camera comes back");
ok(back.bookmarks.length === 2 && back.bookmarks[0].camera.heading === 30 && Math.abs(back.bookmarks[0].viewpoint.center[0] + 117.19) < 0.05, "bookmarks come back with their cameras", back.bookmarks[0]);
ok(back.bookmarks[0].layers.find((l) => l.id === "bld").visible === true && back.bookmarks[0].layers.find((l) => l.id === "pts").visible === false, "and their layers on/off");
ok(back.webscene.ground.layers[0].url.startsWith("https://elevation3d"), "the ground comes back");

const evil = JSON.parse(JSON.stringify(ws));
evil.operationalLayers[0].url = "http://example.com/SceneServer"; evil.ground.layers[0].url = "javascript:alert(1)";
evil.operationalLayers.push({ id: "x", layerType: "NotALayer", url: "https://example.com/x" });
const safe = readWebScene(evil);
ok(safe.ok && !safe.webscene.operationalLayers.some((o) => o.id === "bld" || o.id === "x"), "a layer that isn't https, or of an unknown type, is left out");
ok(safe.webscene.ground.layers[0].url.startsWith("https://elevation3d"), "a ground layer with a bad address is replaced by the standard terrain");
ok(readWebMap(ws).ok && looksLikeWebMap(ws), "(a scene file also has the web map shape, so the scene check runs first)");
const wm2 = docToWebMap(doc, { baseMap: source.baseMap, sourceLayers: [], portalLayers: [] });
ok(!readWebScene(wm2).ok, "a web map file is refused by the scene reader");
console.log(bad ? `${bad} of ${n} FAILED` : `All ${n} checks passed.`); process.exit(bad ? 1 : 0);
