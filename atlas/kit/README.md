# Local save and add data: developer kit

Code for two features MapMaker (the Atlas Instant App) doesn't have today:

- **Local save:** save the map to a file on the device and open it again, with no ArcGIS account.
- **Add data:** add a spreadsheet (CSV) of points, styled from its columns. It's read in the browser; nothing is uploaded.

It's taken from the white-label MapMaker app in this repository (`atlas/`), where both features run in full. The kit is the logic without that app's interface, so it can go into Atlas or any app built with the ArcGIS Maps SDK for JavaScript (4.x or 5.x).

Kit version **1.0**. Created by Jason Sawle.

## What's in it

| File | What it does | Uses the SDK? |
|---|---|---|
| `../lib/csv.js` | Reads CSV text (comma, semicolon or tab; decimal commas; quoted line breaks; latitude/longitude column names in several languages), infers column types, and builds a styled layer definition: six styles including colour by category, size by number, colour ramps and pie charts | No |
| `../lib/doc.js` | Writes a map as web map JSON (Web Map Specification 2.31) and reads it back, with checks for files from anywhere. Also reads the app's older `.mmap` format (Atlas doesn't need that part) | No |
| `add-data.js` | CSV text → layer definition → client-side `FeatureLayer` (and back, for saving) | Yes (classes passed in) |
| `local-save.js` | Save to a file (folder choice in Chrome and Edge, download in Safari and Firefox), open a file, map → web map JSON, web map JSON → `WebMap` with editable sketches and spreadsheet layers | Yes (classes passed in) |
| `example/` | The smallest working app: open a web map, add a CSV, sketch a point, Save, Save as, Open | Yes |

SDK classes are passed in, not imported, so the same code works with the CDN (`$arcgis.import`) and with npm (`@arcgis/core`).

## How it fits together

```
CSV file ──readCsvData──► data ──layerDefFromData──► layer definition ──createDataLayer──► FeatureLayer on the map
                                                       (feature collection JSON)

map + sketches + data layers + bookmarks ──mapToWebMapJson──► web map JSON ──saveWebMapFile──► file.mmap
file.mmap ──openWebMapFile──► JSON ──loadWebMapJson (checks, WebMap.fromJSON)──► WebMap + sketches + data layers
```

The saved file is ordinary web map JSON: the same JSON a web map item stores in ArcGIS Online. So a saved map can also be written to ArcGIS Online as a web map item, and a web map's JSON can be opened from a file.

## Using it

```js
import { readCsvData, layerDefFromData, createDataLayer } from "./kit/add-data.js";
import { saveWebMapFile, openWebMapFile, mapToWebMapJson, loadWebMapJson, sketchGraphic, ITEM_LAYER_PREFIX } from "./kit/local-save.js";

const sdk = { FeatureLayer, Graphic, Field, LabelClass, rendererJsonUtils };   // from the SDK

// 1. Add a CSV
const data = readCsvData(await file.text(), file.name);          // { ok, … } | { needsColumns, header } | { code }
if (data.needsColumns) { /* ask which columns hold latitude and longitude, then readCsvData(text, name, { latIdx, lonIdx }) */ }
const def = layerDefFromData(data, { style: "categorical", color: "Species", label: "Site" });   // or leave options out
const layer = createDataLayer(def, sdk);
map.add(layer); dataLayers.push(layer);

// 2. Save (call from the click; the JSON is built after the file picker opens)
const saved = await saveWebMapFile(() => mapToWebMapJson({ view, sourceJson, sketchLayer, dataLayers, addedLayers, bookmarks, fetchItemData }),
  { handle: lastHandle, saveAs: false, suggestedName: "My map" });

// 3. Open
const f = await openWebMapFile();                               // { json, name, handle } or null
const r = await loadWebMapJson(f.json, { WebMap, Basemap }, { defaultBasemap });
if (r.ok) {
  for (const gj of r.graphics) sketchLayer.add(sketchGraphic(gj, Graphic));
  for (const d of r.layers) r.webmap.add(createDataLayer(d, sdk));
  view.map = r.webmap; sourceJson = r.json;                     // keep r.json: the next save writes its layers
}
```

`example/example.js` shows the whole flow in under 100 lines.

What the app keeps track of:

- **`sourceJson`:** the JSON of the web map that was opened (an item's `/data`, or the opened file). Saving writes its layers with their current visibility and transparency, so the saved file doesn't depend on the original map staying the same.
- **`addedLayers`:** layers added from items (for example from Add layer). Give each one the id `__item_<itemId>`; after opening a file, find them again by that prefix.
- **`sketchLayer`:** a `GraphicsLayer`. Each sketch is saved with `{ kind, title, description, imageUrl, color, size, rotation }`. Sketches drawn by another tool are read from their symbols (`sketchAttributes`).
- **`bookmarks`:** `{ title, viewpoint: { center, zoom } | { extent }, layers: [{ id, visible }], thumb }`. Each bookmark's layers on/off is saved in a matching presentation slide, because the specification's bookmark has no layer list.

## Where it would go in Atlas

| Atlas today | With the kit |
|---|---|
| **Save:** PDF, screenshot, save to my ArcGIS Online account | Add **Save to this device** and **Save as**. Atlas's Save to ArcGIS Online already builds a web map for the portal; the file is that same JSON |
| **Open map:** maps from the group | Add an **On this device** tab |
| **Add layer:** layers from the group | Add a **Your own data** tab: choose or drop a CSV, check the columns, pick a style with a live preview |
| **Sketch** and **Bookmarks** | No change; their content goes into the file and comes back editable |

The white-label app (`atlas/`) shows each of these in a MapMaker-style interface: <https://jsawle.github.io/localmapsave/atlas/?config=mapmaker>.

## Files from anywhere are checked before they load

A saved map can come from a student, a teacher's LMS, or anywhere else. `readWebMap` (used by `loadWebMapJson`) applies these checks:

- **Layers:**
  - must be a layer type the specification defines;
  - must load from `https` addresses (other layers are left out);
  - group layers are checked layer by layer.
- **Pictures:** pop-up pictures and picture symbols must be embedded or come from `https`. Picture symbols that would load from anywhere else are replaced with plain ones.
- **Size:** files are capped at 5,000 features.
- **Messages:** anything left out is counted, so the app can say so.
- **Sketches and spreadsheet layers:** rebuilt from checked fields, not loaded as they are.
- **ArcGIS Online items:** `{ trusted: true }` skips the address checks for an item's data opened by ID, as Map Viewer does.

## Privacy

- **Without sign-in:** nothing a student adds, draws or saves is sent anywhere. CSV files are read in the browser and saved maps are files on the device. On school devices those files usually land in the student's Drive or LMS storage, which the school already covers.
- **What is loaded:** the app still loads basemaps and layers from ArcGIS Online. Opening a saved map loads its layers from the addresses written in it.

## Browser support

| | Save | Open |
|---|---|---|
| Chrome, Edge (incl. Chromebooks) | Choose a folder and name; Save overwrites the same file | File picker |
| Safari, Firefox, iPad | Downloads the file | Ordinary file input |

## Tests

- **Unit tests:** `node atlas/tests/run.mjs` runs CSV reading and styling, web map writing and reading, the file checks, and the kit's functions with stand-in SDK classes.
- **Browser tests:** `python3 atlas/tests/smoke/smoke.py` (Python Playwright with Chromium) runs the white-label app and the example in a browser. It uses a stand-in ArcGIS library and includes an accessibility scan.
- **Not tested:** neither has run against the real ArcGIS library from the build machine. The live pages are the real test.

## Not in the kit

- **The interface:** the CSV options panel with live preview, the file dialogs, and the unsaved-work warning. These are in `atlas/app.js` and `atlas/index.html` and would be rebuilt in Atlas's own components.
- **Translations:** these come from Atlas's string files.
- **Opening older `.mmap` files:** `sanitizeDoc` in `lib/doc.js` handles them; Atlas has no older files to open.

## Effort for the Atlas team (estimate)

This assumes one developer who knows the Atlas code and the SDK, using this kit's logic. Atlas's code isn't public, so how its Save, Sketch and Bookmarks work inside is a guess, and that guess moves the numbers. This is a judgement, not a measurement. The prototype was built with AI assistance, so its build time is no guide.

| Work | Already in the kit | Left for Atlas | Estimate |
|---|---|---|---|
| Save to a file | Web map writer; file save with folder choice or download | Menu items in Save; feeding Atlas's sketches, bookmarks and added layers to the writer (or reusing what Save to ArcGIS Online builds); unsaved-work warning | 1–2 weeks |
| Open a file | Reader with file checks; `WebMap.fromJSON`; editable sketches and data layers | "On this device" in Open map; handing sketches back to Atlas's Sketch tool; bookmarks; error messages | 1–2 weeks |
| Add a CSV | Parsing, column types, six styles, layer creation | Calcite interface: choose or drop a file, column picker, style chooser, live preview; Legend and Layer list | 2–4 weeks (1–2 with automatic styling only) |
| Settings | — | Switches in the Atlas builder (express and full setup) | about 1 week |
| Languages, accessibility, help | English strings | Translation of new strings, accessibility review, help pages | 1–2 weeks, plus translation turnaround |
| Testing and review | Unit and browser tests (stand-in SDK) | Real-browser testing: Chrome, Edge, Safari, Firefox, iPad, managed Chromebooks; large files; security review of opening files | 2–3 weeks |
| **Total** | | | **about 8–14 developer-weeks** |

The smallest useful version would be Save to this device, Open from this device, and CSV with automatic styling only. That is about **5–7 developer-weeks**.

It's moderate work, not hard. Everything runs in the browser with standard SDK pieces (client-side `FeatureLayer`, `WebMap.fromJSON`), with no new server, service or data store. Most of the time goes on the interface, the Instant Apps process (settings, translation, accessibility) and testing.

Three things would change the estimate:
- whether Atlas's Save to ArcGIS Online already turns sketches into layers;
- whether the SDK team would expose writing a `WebMap` to JSON without a portal, since `saveAs` already does this inside the SDK;
- how much of the CSV styling is wanted.

## Versions

| Part | Version |
|---|---|
| Kit | 1.0 |
| CSV reading and styling (`lib/csv.js`) | 3.0 |
| Web map writer (`lib/doc.js`) | 2.0, writing Web Map Specification 2.31 |
