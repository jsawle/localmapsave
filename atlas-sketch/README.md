# Atlas: Sketch and Filter lab

A lab copy of the white-label Atlas app (`../atlas/`) for demos. It's the same app, version **1.15.0-sketch.12**, but Sketch uses the SDK's Sketch component, which is Map Viewer's drawing toolbar, instead of the app's own tool buttons. The full description, versions table and known limits are in the `sketch-mapviewer` branch's `atlas/README.md` (pull request #27).

| Link | What you get |
|---|---|
| `https://jsawle.github.io/localmapsave/atlas-sketch/` | Neutral "School Atlas" branding |
| `…/atlas-sketch/?config=mapmaker` | MapMaker's groups, units, colours and wording |
| `…/atlas-sketch/?config=example-es` | Spanish-language version |

Apart from Sketch, the two apps are the same: CSV 3.4, the Coordinates fixes, and saving (1.14.5 / 1.15.0-sketch.6). **Lab only for now (1.15.0-sketch.7): locked maps.** *Save a locked copy* writes a map that Save in this app never changes (a teacher's class map, a student's hand-in); the mark is inside the file. Opening one is just looking; Save makes your own copy. Any other map file saves back to itself on any device. 1.15.0-sketch.8 rewords the message after saving a locked copy: it used to say nobody could save over it, but Save as can still replace a locked map that wasn't opened in that session. Two people saving the same unlocked map on a shared drive: whoever saves last wins, with no warning. 1.15.0-sketch.9: picking a file in the save box that Chrome can't write (someone else's, or read-only) used to do nothing at all, because Chrome reports it the same way as Cancel. The app now says nothing was saved and to choose another name or folder. Found by the simulated Chromebook test (`../atlas/tests/chromebook-sim/`). 1.15.0-sketch.10 (with main 1.14.7): the Save panel's notes become explanations on each tile, and Sign in is a tile beside Print. The main app gets this in its own pull request once it's been tried here.

1.15.0-sketch.11 has the same code-review fixes as the main app's 1.14.8 (a message when the map library doesn't load, save notes shown one after the other, the close-tab warning for an unadded spreadsheet).

## Filter (lab only, 1.15.0-sketch.12)

Each layer in **Map layers** that holds features has a **Filter** button beside Table. It opens a panel laid out like Map Viewer's filter: the layer's name, *Show features where*, then one or more conditions (field, condition, value), **Add new**, **Clear all**, and **Apply** / **Cancel**.

- **Number fields:** is, is not, is at least, is at most, is greater than, is less than, is between, is blank, is not blank. A histogram of the field's values has a slider on it; the slider and the number box move together, and the bars the condition includes are coloured.
- **Text fields:** is, is not (with the field's own values to choose from), includes, does not include, starts with, ends with, is blank, is not blank.
- **Several conditions** (up to 6) match all or at least one, under *Filter results*.
- **A count** under the conditions says how many features are shown ("Showing 368 of 949 features"). Map Viewer doesn't show one; it's there because the count is often the answer to the question a student is asking.
- **The map follows as you go.** Apply keeps the filter; Cancel, ×, Escape or opening another tool puts the layer back as it was. The Filter button is marked, and named "Filter (on)", when its layer has a filter.
- **Fields offered** are the ones the layer's pop-up shows (under their aliases); if the pop-up has no field list, every number and text field.
- **Spreadsheet (CSV) layers** can be filtered too. All their rows stay in the saved map.

**What it's built from.** Map Viewer's filter panel isn't published as a component, so the panel is assembled from the same standard parts: Esri's Calcite components (`calcite-select`, `calcite-input-number`, `calcite-input-text`, `calcite-combobox`, `calcite-button`) and the SDK's **Histogram** and **Slider** components (`arcgis-histogram` inside `arcgis-slider`, as in Esri's "Histogram Range Slider" sample; these replace the HistogramRangeSlider widget, deprecated in SDK 5.0). The layout, the logic that turns conditions into SQL and back (`lib/filter.js`, Filter 1.0) and the count are this app's.

**How it's saved.** A filter is the layer's `definitionExpression` in the web map (`layerDefinition.definitionExpression`, Web Map Specification), which is how Map Viewer saves one, so the `.amap` still holds only what the specification defines and the filter shows in other ArcGIS apps. Nothing else is stored: when a map is opened, the conditions are read back from that SQL. A filter that was cleared from a layer that came with one is saved as `1=1`, so the layer's original filter doesn't return.

**Known limits**
- **Dates** can't be filtered yet (number and text fields only), and there's no filter by area or distance.
- **A filter written elsewhere** in a form the panel doesn't have (IN lists, functions, AND mixed with OR) is kept as it is and shown as text; conditions added in the panel are added to it, and Clear all leaves it on.
- **A map's own filter can be cleared** by anyone, as in Map Viewer. A map that relies on a filter to hide data shouldn't.
- **Only layers that hold features** have the button (feature, CSV, GeoJSON and WFS layers). Tile, imagery and map-image layers can't be filtered this way.
- **"Apply", not Map Viewer's "Save":** in this app Save means saving the map, and a filter isn't saved until the map is.
- **Switching 2D/3D** while the panel is open closes it without applying.
- **The histogram** needs the field to have a range of values; with one value, or if the components don't load, the number box still works.
- **Tests:** `node atlas-sketch/tests/filter.test.mjs` (the SQL logic, 12 tests) and `python3 atlas-sketch/tests/live-filter.py` (the panel on the real SDK against MapMaker's Major Earthquakes map: 34 checks, with an axe-core scan of the panel).

The working app stays at `https://jsawle.github.io/localmapsave/atlas/` (1.14.8), so the two can be shown side by side.

- **Saved maps** use the same `.amap` format, so a file saved in either app opens in the other. Both apps are on the same site, so *My map files* lists the same maps in both.
- **Sign-in** needs `https://jsawle.github.io/localmapsave/atlas-sketch/oauth-callback.html` added as a redirect URI on the app's client ID in ArcGIS Online. Until then, use sign-in in the main app.
- **Tests** live with the main app in `../atlas/tests/` (on the `sketch-mapviewer` branch for this version). This folder holds only what the page loads.
- **When Sketch moves into the main app**, delete this folder.
