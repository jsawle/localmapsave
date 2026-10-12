// The smallest app that uses the kit: open a web map, add a CSV, sketch, save to a file, open it again.
// Everything Atlas-specific (its toolbar, dialogs, configuration) is left out on purpose.
import { readCsvData, layerDefFromData, createDataLayer, CSV_VERSION } from "../add-data.js";
import { saveWebMapFile, openWebMapFile, mapToWebMapJson, loadWebMapJson, sketchGraphic, titleFromFileName, ITEM_LAYER_PREFIX,
  KIT_VERSION, WEBMAP_SPEC_VERSION } from "../local-save.js";

const [EsriMap, WebMap, MapView, Basemap, GraphicsLayer, FeatureLayer, Graphic, Field, LabelClass, rendererJsonUtils, SketchViewModel, esriRequest] = await $arcgis.import([
  "@arcgis/core/Map.js", "@arcgis/core/WebMap.js", "@arcgis/core/views/MapView.js", "@arcgis/core/Basemap.js", "@arcgis/core/layers/GraphicsLayer.js",
  "@arcgis/core/layers/FeatureLayer.js", "@arcgis/core/Graphic.js", "@arcgis/core/layers/support/Field.js", "@arcgis/core/layers/support/LabelClass.js",
  "@arcgis/core/renderers/support/jsonUtils.js", "@arcgis/core/widgets/Sketch/SketchViewModel.js", "@arcgis/core/request.js"
]);
const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg; };
$("versions").textContent = "Kit " + KIT_VERSION + " · CSV " + CSV_VERSION + " · web map " + WEBMAP_SPEC_VERSION;

const PORTAL = "https://www.arcgis.com";
const fetchItemData = (id) => esriRequest(PORTAL + "/sharing/rest/content/items/" + id + "/data", { query: { f: "json" }, responseType: "json" }).then((r) => r.data);
const defaultBasemap = () => new Basemap({ portalItem: { id: "a82ff7ce1c3a493f9d82aa89f5a1ddcf" } });
const sdk = { FeatureLayer, Graphic, Field, LabelClass, rendererJsonUtils };

// What the app keeps track of, and what saving needs.
const sketchLayer = new GraphicsLayer({ id: "__sketch", title: "My sketches" });
let dataLayers = [], addedLayers = [], sourceJson = null, fileHandle = null, mapName = "";
const view = new MapView({ container: "viewDiv", map: new EsriMap({ basemap: defaultBasemap(), layers: [sketchLayer] }), center: [0, 20], zoom: 2 });
view.when(() => status("Ready. Add a CSV, sketch, then Save."));
function useMap(map) {
  if (!map.layers.includes(sketchLayer)) map.add(sketchLayer);
  view.map = map;
}
function reset() { sketchLayer.removeAll(); dataLayers = []; addedLayers = []; sourceJson = null; fileHandle = null; mapName = ""; }

// ---------- Open a web map from ArcGIS Online (keep its JSON: saving writes its layers with their current visibility)
$("openItem").addEventListener("click", async () => {
  const id = $("itemId").value.trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) { status("Enter a 32-character web map item ID."); return; }
  try {
    const wm = new WebMap({ portalItem: { id } });
    await wm.load();
    reset(); sourceJson = await fetchItemData(id); mapName = wm.portalItem.title || "";
    useMap(wm);
    if (wm.initialViewProperties && wm.initialViewProperties.viewpoint) view.goTo(wm.initialViewProperties.viewpoint).catch(() => {});
    status("Opened " + (mapName || id) + ".");
  } catch (e) { console.error(e); status("Couldn't open that web map."); }
});
$("newMap").addEventListener("click", () => { reset(); useMap(new EsriMap({ basemap: defaultBasemap() })); status("New map."); });

// ---------- Add a CSV: read in the browser, styled from its columns, added as a client-side layer
$("csvInput").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0]; e.target.value = "";
  if (!file) return;
  const data = readCsvData(await file.text(), file.name);
  if (!data.ok) { status(data.needsColumns ? "No latitude/longitude columns found. (The full app asks which columns to use.)" : "That file can't be mapped: " + data.code + "."); return; }
  const def = layerDefFromData(data);              // automatic style; pass { style, color, size, label, … } to choose
  const layer = createDataLayer(def, sdk);
  view.map.add(layer); dataLayers.push(layer);
  view.map.reorder(sketchLayer, view.map.layers.length - 1);
  status("Added " + def.features.length + " points from " + file.name + (data.dropped ? " (" + data.dropped + " rows had no usable coordinates)." : "."));
});

// ---------- Sketch a point (its colour and size are read from the symbol when saving)
const sketchVM = new SketchViewModel({ view, layer: sketchLayer, pointSymbol: { type: "simple-marker", style: "circle", color: "#d4572a", size: 12, outline: { color: "#ffffff", width: 1.5 } } });
$("drawPoint").addEventListener("click", () => { sketchVM.create("point"); status("Click on the map to place the point."); });
sketchVM.on("create", (e) => { if (e.state === "complete") { e.graphic.attributes = { title: "Point " + sketchLayer.graphics.length, description: "" }; status("Point added."); } });

// ---------- Save to a file on this device (a web map). The JSON is built after the file picker opens.
async function save(saveAs) {
  try {
    const r = await saveWebMapFile(() => mapToWebMapJson({ view, sourceJson, sketchLayer, dataLayers, addedLayers, fetchItemData,
      appName: "Atlas kit example", appVersion: KIT_VERSION, sketchTitle: "My sketches" }), { handle: fileHandle, saveAs, suggestedName: mapName || "map" });
    if (!r) return;                                  // cancelled
    fileHandle = r.handle;
    if (!mapName) mapName = titleFromFileName(r.name);
    status("Saved " + r.name + (r.handle ? "." : " to your downloads.") + (r.result && r.result.skippedLayers ? " " + r.result.skippedLayers + " layer(s) couldn't be written." : ""));
  } catch (e) { console.error(e); status("Couldn't save the file."); }
}
$("save").addEventListener("click", () => save(false));
$("saveAs").addEventListener("click", () => save(true));

// ---------- Open a saved map: checked, loaded, sketches and spreadsheets made editable again
$("openFile").addEventListener("click", async () => {
  try {
    const f = await openWebMapFile();
    if (!f) return;
    const r = await loadWebMapJson(f.json, { WebMap, Basemap }, { defaultBasemap: defaultBasemap() });
    if (!r.ok) { status("That isn't a saved map or a web map file."); return; }
    reset();
    for (const gj of r.graphics) sketchLayer.add(sketchGraphic(gj, Graphic));
    sketchLayer.visible = r.sketchVisible !== false;
    for (const def of r.layers) { const l = createDataLayer(def, sdk); r.webmap.add(l); dataLayers.push(l); }
    addedLayers = r.webmap.layers.toArray().filter((l) => typeof l.id === "string" && l.id.startsWith(ITEM_LAYER_PREFIX));
    useMap(r.webmap);
    sourceJson = r.json; fileHandle = f.handle; mapName = titleFromFileName(f.name);
    const vp = r.webmap.initialViewProperties && r.webmap.initialViewProperties.viewpoint;
    if (vp) view.goTo(vp, { animate: false }).catch(() => {});
    status("Opened " + f.name + ": " + r.graphics.length + " sketch(es), " + r.layers.length + " spreadsheet layer(s)" + (r.skipped ? ", " + r.skipped + " item(s) left out by the file checks." : "."));
  } catch (e) { console.error(e); status("Couldn't read that file."); }
});
