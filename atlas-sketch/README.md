# Atlas 5.0 (beta)

**Atlas 5.0** is the white-label Atlas / MapMaker app with local save, adding your own data, filtering and Map Viewer's sketch tools. The MapMaker that is live today (the Atlas Instant App) is 4.0. This folder is 5.0, version **5.0.0-beta.11**, on ArcGIS Maps SDK for JavaScript 5.2. It grew from a lab copy of the earlier white-label app (`../atlas/`, 1.14.8, kept as it is): Sketch uses the SDK's Sketch component, which is Map Viewer's drawing toolbar, instead of the app's own tool buttons. The full description, versions table and known limits are in the `sketch-mapviewer` branch's `atlas/README.md` (pull request #27).

| Link | What you get |
|---|---|
| `https://jsawle.github.io/localmapsave/atlas-sketch/` | Neutral "School Atlas" branding |
| `…/atlas-sketch/?config=mapmaker` | MapMaker's groups, units, colours and wording |
| `…/atlas-sketch/?config=example-es` | Spanish-language version |

Apart from Sketch, the two apps are the same: CSV 3.4, the Coordinates fixes, and saving (1.14.5 / 1.15.0-sketch.6). **Lab only for now (1.15.0-sketch.7): locked maps.** *Save a locked copy* writes a map that Save in this app never changes (a teacher's class map, a student's hand-in); the mark is inside the file. Opening one is just looking; Save makes your own copy. Any other map file saves back to itself on any device. 1.15.0-sketch.8 rewords the message after saving a locked copy: it used to say nobody could save over it, but Save as can still replace a locked map that wasn't opened in that session. Two people saving the same unlocked map on a shared drive: whoever saves last wins, with no warning. 1.15.0-sketch.9: picking a file in the save box that Chrome can't write (someone else's, or read-only) used to do nothing at all, because Chrome reports it the same way as Cancel. The app now says nothing was saved and to choose another name or folder. Found by the simulated Chromebook test (`../atlas/tests/chromebook-sim/`). 1.15.0-sketch.10 (with main 1.14.7): the Save panel's notes become explanations on each tile, and Sign in is a tile beside Print. The main app gets this in its own pull request once it's been tried here.

1.15.0-sketch.11 has the same code-review fixes as the main app's 1.14.8 (a message when the map library doesn't load, save notes shown one after the other, the close-tab warning for an unadded spreadsheet).

## Elevation: drawn lines take the shortest way round (5.0.0-beta.11)

A line drawn in the Elevation tool is now geodesic (Elevation profile 3.1): between the places clicked it follows the great circle, the shortest way over the Earth, and the heights are read along that path. On the flat (Web Mercator) map a long line therefore shows as a curve, bowing towards the pole; a short line looks as it did. Before, the line was straight on the map, which is a line of constant compass bearing and a longer way round. The line being drawn is shown the same way before it is finished. A line that crosses the 180° meridian stays in one piece.

A line **chosen** on the map (a sketch, a line feature) is still followed exactly as it is drawn there, so the dot stays on the sketched line. Lines are kept between 85°N and 85°S (Web Mercator has no poles). Also: the chart's surface line is 1px (was 2px), and the last distance label no longer runs off the right edge.

Tests: `python3 atlas-sketch/tests/live-elevation.py` (44 checks).

## Elevation: the app's own chart (5.0.0-beta.10)

The Elevation tool no longer uses Esri's Elevation Profile widget (one of the widgets SDK 6.0 removes; it could not be given a sea-level line or a filled chart). The tool and its chart are now the app's own (Elevation profile 3.0).

| | What it does |
|---|---|
| Layout | The chart runs the whole width under the map. The line's figures (length, highest, lowest, total climb, total descent) are one row beneath it |
| Text | Scale labels 13px, figure labels 14px, figures 16px bold, near-black on white |
| Sea level | Where the line goes below sea level the water is drawn and a dashed line, named "Sea level", marks it. Heights come from Esri's World Elevation **TopoBathy 3D** service, which has the sea floor |
| Earth colours | The land is filled with a gradient, lightest at the line's highest point and darker down to the bottom of the chart |
| Dot on the map | Moving over the chart, or the arrow keys when the chart has focus (Home, End, Shift for bigger steps), puts a dot at that place on the line on the map, with its distance and height shown on the chart. Works for a drawn line and for a sketched line |
| Choosing a line | Over a line that can be chosen (a sketched line, or a line feature of a layer) the pointer becomes the hand; a click charts it. Sketched lines are also in a list, for keyboard use. Elsewhere the pointer is a crosshair: click for each point, double-click or Enter to finish, Escape to give up |

Heights are read at up to 512 points along the line in one request. Units follow `units` in the config. Not built: drawing a new line with the keyboard alone (a sketched line can be chosen from the list); the slope figures the widget had.

Tests: `python3 atlas-sketch/tests/live-elevation.py` (39 checks, with an axe-core scan).

## Segment labels, snapping, whole-number measurements (5.0.0-beta.8)

On from the start while sketching, each with a switch in the toolbar's Settings and in a config:

| What | Config | Notes |
|---|---|---|
| Tooltips | `sketchTooltips` | Since beta.7. |
| Segment labels | `sketchLabels` | The length of each side while a line or area is drawn or reshaped. |
| Snapping | `sketchSnapping` | To other sketches, and to right angles and parallels within the shape being drawn. The SDK snaps within 5 pixels. Since beta.9 sketches are the only snapping layer (beta.8 included spreadsheet layers); `"sketchSnapTo": "sketches-and-data"` in a config adds them back. Layers of the opened map are not snapping layers. |
| Decimal places | `sketchDecimals` | Lengths and areas in tooltips and labels are shown with none ("1,199 km", "8,610 m²"). A number gives that many places; `null` leaves the SDK's two. |

**How the rounding is done.** The SDK has no setting for decimal places: the Sketch component's value options choose units only. The tooltips and labels are ordinary page text inside the map component, so the app rounds that text as it is written. It depends on how the SDK writes those texts today, so an SDK update could bring the decimals back; the live test would then fail. Coordinates and angles are left as they are. The SDK still changes unit with scale (km, then m), so short lengths do not become "0 km".

Tests: `python3 atlas-sketch/tests/live-sketch-measure.py` (12 checks): the four side labels of a rectangle, no decimals on any length or area, and a line started 4 pixels from a sketched point starting exactly on it (0.00 m apart where a pixel was 19,568 m), against the same start with snapping off (70 km away), and against a spreadsheet point, which is not snapped to. Not tested: labels, snapping and rounding in 3D; snapping to edges and to right angles.

## Areas as Map Viewer sets them up, and tooltips (5.0.0-beta.7)

For an area (polygon, rectangle, circle, freehand) the panel now has, in Map Viewer's order:

| Control | Notes |
|---|---|
| Recent polygon symbols | The last five styled fills used; says so when there are none. |
| Current symbol | "Basic polygon", or a styled fill. Opens Change symbol with three categories from Esri's sketch styles: Hatch fill (20), Land use and land cover (56), Pencil landscape (13). |
| Fill colour | The eight palette colours, a colour of your own (the browser's colour picker), or No fill. |
| Fill transparency | Slider and number box, 0 to 100%. Starts at 75, as before. |
| Outline colour | As Fill colour, with No outline. |
| Outline transparency | Slider and number box. |
| Outline width | Slider and number box, 0 to 12 px. |
| Outline pattern | The five line patterns (this app's addition; Map Viewer puts patterns under the symbol). |

With a styled fill chosen only the symbol is offered: it is used as it is. **In 3D the SDK draws a styled fill as its outline only** (seen in a test of four of them); the Change symbol view says so. Esri's "Polygon Fill" style (127 plain colour fills) is left out, since Fill colour does that job.

Saved-map format 3.2: an area keeps `fillColor`, `outlineTransparency` and `outlineWidth`; `fill` is still how solid the fill is. Earlier files open as they did.

**Tooltips** are on from the start while drawing (the place under the pointer, a line's length, an area's size), as in the Map Viewer screenshot. The toolbar's Settings turns them off; `"sketchTooltips": false` in a config starts with them off.

Tests: `python3 atlas-sketch/tests/live-sketch-styles.py` (59 checks).

## Sketch panel and symbols, second pass (5.0.0-beta.6)

**Where Map Viewer's symbols come from.** ArcGIS Online names four groups of styles in its settings (`…/sharing/rest/portals/self`). Map Viewer's Sketch uses `2DSketchStylesGroupQuery`: the group "Esri Sketch Styles" (`045b1ef5300f4ba98f5cfb2a55754921`, owner esri_en), 23 web styles. Sixteen hold point symbols. This app offers 13 of them plus the Places set from beta.5:

| Category | Symbols | Takes the chosen colour | Named |
|---|---|---|---|
| Pins | 16 | yes | yes |
| Numbers | 40 (numbered pins and circles) | yes | yes |
| Shapes | 78, plus the plain circle | yes | yes |
| Arrows | 50 | yes | yes |
| Places | 61 (School, Park, Hospital…) | yes | yes |
| Animals | 48 (Fox, Bear, Turtle…) | no | yes |
| Buildings | 58 | yes | yes |
| Vehicles | 54 | no | yes |
| Trees | 81 | no | numbered only |
| Landforms | 161 | no | numbered only |
| Natural landscape 1, 2 | 125, 211 | no | numbered only |
| Human landscape 1, 2 | 120, 88 | no | numbered only |

Left out: Calcite Symbols (609 interface icons), Animated and Firefly. `sketchSymbolSets` in a config lists the categories to offer; `sketchSymbolsLeftOut` names single symbols to leave out (default Bar, Casino, Vineyard). The sets Esri only numbers ("Symbol 12") are announced to a screen reader as "Trees, Symbol 12": there is no better name to give.

**The panel**, laid out like Map Viewer's Sketch pane:

- A line at the top says what the tool in hand does ("Click the map to add a point.").
- Point: Recent symbols (the last five, kept on the device), Current symbol, Colour (when the symbol takes one), Size. Current symbol opens **Change symbol**: Category, Search, the symbols using the panel's full height, Done.
- A selected sketch: Name, Pop-up (a view of its own: description and image), Duplicate, Delete.
- One toolbar on the map. The Sketch component's own Duplicate and Delete made a second bar when a sketch was selected; they are turned off and the panel's buttons call the same component methods.
- "Go to the drawing tools" is still the first thing Tab reaches in the panel, and is shown only when it has focus.

A sketch's symbol is saved as `web:<style item id>/<symbol name>`; beta.5's `web:school` still opens. Tests: `python3 atlas-sketch/tests/live-sketch-styles.py` (45 checks).

## Sketch styles (5.0.0-beta.5)

Modelled on Map Viewer's sketch tools: a toolbar on the map, and a pane that changes with the tool in use.

| What | How it works |
|---|---|
| Toolbar | The SDK's Sketch component, laid out vertically on the right of the map beside the Sketch panel (across the top on a phone). Smaller buttons on a screen under 820 px high, so every tool shows without a "more" menu. |
| Panel | Shows what suits the tool chosen or the sketch selected. Point: Symbol, Colour, Size. Line: Colour, Width, Pattern, Arrow. Area: Colour, Outline, Fill. Text: Colour, Size, Rotation. A selected sketch also has its Pop-up. With no tool and nothing selected, only a hint. |
| Point symbols | Esri's vector point symbols: the "2D point symbols" web style (item `220936cc6ed342c9937abd8f180e7d1e`), which is the default vector set in Map Viewer. Two sets: Shapes (35) and Places and pins (61: School, Park, Hospital, Airport, pins…). They take the chosen colour and size. Bar, Casino and Vineyard are left out; `sketchSymbolsLeftOut` in a config changes that list. |
| Lines | Five patterns (solid, dashed, dotted, dash and dot, long dashes) and arrows (none, end, start, both). |
| Areas | How solid the fill is (0 to 100%), and the outline's pattern. |
| Carry on | A style chosen applies to the selected sketch and to the next ones drawn, as in Map Viewer. |
| Saved | Each sketch keeps its choices (`shape`, `pattern`, `arrow`, `fill`), and the file's renderer holds the real symbols: a `CIMSymbolReference` for a vector point, `esriSLS` styles with a `marker` for arrows. Saved-map format 3.1. Files saved before open as they did. |

Not done, or not tested: Map Viewer's other symbol sets (animals, arrows, and so on) and uploading your own picture; fonts for text; line and outline transparency; a custom colour picker. The new styles were tested in 2D; in 3D they were seen to draw (vector symbol, dashes, arrowhead) in one check by eye, not in the automated tests. Opening a saved map in Map Viewer itself has not been tried.

Tests: `python3 atlas-sketch/tests/live-sketch-styles.py` (30 checks).

## Sketch in 3D, and loading on a slow connection (5.0.0-beta.4)

**Sketch in 3D.** The Sketch toolbar (the SDK's Sketch component) works in the 3D view of a map and in a web scene with the same tools as in 2D: point, line, area, rectangle, circle and text. Nothing had to be built for drawing. One thing was wrong: a sketch drawn in 3D was saved with a height of 0 on every point. Sketches lie on the ground, so they are now saved as flat shapes, the same as ones drawn in 2D. Not tested: moving and reshaping a sketch in 3D, freehand drawing in 3D, and drawing on a tilted view.

**Loading.** Opening `?config=mapmaker&webmap=…` (Major Earthquakes) with an empty cache on a connection held to 1.6 Mbit/s with 150 ms delay, one run each:

| | beta.3 | beta.4 |
|---|---|---|
| Usable (map drawn, layers listed) | 37.0 s | 30.2 s |
| Requests | 683 | 349 |
| Downloaded | 4.0 MB | 3.1 MB |

What changed: the opened map's item and JSON were each downloaded twice, now once; a linked map starts downloading at once and no default basemap is loaded first; the code for Legend, Measure, Coordinates, Elevation and Sketch is downloaded when the tool is first opened. Of what is left, 1.7 MB in 275 requests is the SDK itself. The test serves the app's own files uncompressed (435 kB); GitHub Pages compresses them.

Measure it: `python3 atlas-sketch/tests/perf.py` (add `--fast` for no throttling). Tests: `python3 atlas-sketch/tests/live-sketch3d.py` (16 checks).

## Filtering and spreadsheet data in 3D (5.0.0-beta.3)

| What | How it works |
|---|---|
| Filter in 3D | The Filter panel works in the 3D view of a web map and in a web scene, the same way as in 2D: the view follows a typed value without Apply, Cancel puts it back, Apply keeps it in both views and in the saved file. It needed no new code, only testing. It covers the layer types Filter already covers (feature, CSV, GeoJSON, WFS, OGC feature); a scene's 3D building, mesh and point cloud layers have no Filter button. |
| Spreadsheet data in 3D | A CSV can be added while in 3D or in a scene. Its features lie on the ground (`elevationInfo: on-the-ground`), drawn on the terrain with the basemap, so the view has no height to work out per feature. Symbols therefore lie flat when the view is tilted. The 1,000-row limit is unchanged. In a scene the layer is saved in the scene file and comes back, with its filter. CSV 3.5. |
| 3D quality | `threeDQuality` in a config, or `?quality=low|medium|high` in a link. The default, `auto`, picks the SDK's low quality profile (smaller textures, less memory, no shadows or stars) on a device with 4 GB of memory or less, 4 processor cores or fewer, or no graphics chip, and medium otherwise. |

Fixed on the way: in a scene the layer count on the Map layers tool stayed at 0, and the basemap gallery followed the 2D view (both looked at the 2D view's map only); a move of the view asked for while 3D was still tilting into place could be mixed up with it, and now waits for it.

Not known: how 3D performs on real school devices. The test browser draws 3D in software at one or two frames a second, which says nothing about a Chromebook with a graphics chip. The live test lifts the test scene's camera to look straight down from 30 km for that reason. One of the test's runs in three reported a script error with no message or stack that later runs didn't repeat; its cause isn't found.

Tests: `python3 atlas-sketch/tests/live-3d-data.py` (21 checks).

## 3D scenes and the 2D-only tag (5.0.0-beta.2)

| What | How it works |
|---|---|
| Open a web scene | From a link, `?webscene=<item id>`, or from Open map, where the collection's web scenes are listed beside its web maps and marked **3D**. With `webmap` and `webscene` in one link, the scene opens. |
| A scene is 3D only | It opens in 3D and the 2D button is unavailable, with the reason. Its slides are the bookmarks, each with its camera. |
| A web map can be 2D only | Add the tag `atlas-2d-only` to the web map's ArcGIS Online item. The 3D button is then unavailable, with the reason. A copy saved to a device keeps this (`"atlas2dOnly": true` in the file). |
| Save a scene | The `.amap` file holds a web scene (Web Scene Specification 1.40): the scene's layers, ground and lighting, the camera, bookmarks as slides, sketches and spreadsheet layers. A scene has `viewingMode` and `ground`, which is how the app tells it from a web map. Saved-map format 3.0. |
| Share | Share on a scene's card copies a `webscene=` link. |
| Views | The 2D and 3D views are the SDK's `arcgis-map` and `arcgis-scene` components. Search, Home, Zoom, the 3D navigation toggle and the scale bar are components in their slots (they were widgets, which SDK 6 removes). |

Not done yet, or not tested:

- A scene can't be saved to ArcGIS Online from the app (signed in); it says so. Saving to a device works.
- Sketching in a scene, and a spreadsheet layer in a scene, are saved by the same code as in a web map, and the unit tests cover the file. Drawing in 3D has not been tested in a browser.
- Local scenes (flat, not a globe) are handled in code but no local scene has been opened in a test.
- A scene or map with a layer that isn't shared publicly makes the SDK ask the reader to sign in. Three of Esri's older sample scenes do this. Content for classes needs every layer public.
- Still widgets, to be moved to components: Measurement, Coordinate Conversion, Legend, Swipe, Feature Table. (Elevation Profile was replaced by the app's own chart in beta.10.)

Tests: `node atlas-sketch/tests/scenes.test.mjs` (24 checks on the file format) and `python3 atlas-sketch/tests/live-scenes.py` (35 checks in Chromium against the real SDK and ArcGIS Online). The MapMaker collection has no web scene and no tagged map yet, so the live test adds the tag, and puts a scene in the list, by changing the services' answers on their way to the app. It also leaves a city scene's 3D buildings out, because the test browser draws 3D in software.

## Parity with MapMaker 4.0 (since 5.0.0-beta.1)

A tool-by-tool inventory of the live MapMaker (11 November 2026) found seven things 4.0 has that this app didn't. Four are added here:

| 4.0 feature | In 5.0 |
|---|---|
| **Elevation** as its own toolbar tool | Added, after Measure. Measure now opens its panel directly. A version that prefers the old menu sets `"elevationTool": "menu"` |
| **Remove all layers** in Map layers | Added (the bin in the panel's heading). It asks first, because the list can hold a spreadsheet that isn't saved anywhere else. Sketches stay. Switch off with `features.removeAllLayers: false` |
| **Share** on each map in Open map | Added. It copies a link that opens that map in this app with the same settings (`?config=…&webmap=…`). Switch off with `features.share: false` |
| **Time tool** for time-aware maps | Added: the SDK's Time Bar component (new in 5.2), shown above the toolbar on maps saved with time settings, set up from those settings. Saved maps keep the settings and the slider's place (`widgets.timeSlider`, Web Map Specification). Switch off with `features.time: false` |
| **Charts** beside a layer's table | Not built. None of the 183 items in MapMaker's content group has a chart configured, so there is nothing to show or test against yet |
| **Built on map and scene components** | Not started. This is the same work as preparing for SDK 6.0, which removes widgets and the view classes this app uses |
| **Layer search, buffer tool, parquet layers** (November 2026 Atlas update) | Not built |

Where 5.0 is ahead of 4.0: local save, Save as and locked copies; the list of saved map files; adding a spreadsheet; filtering; creating bookmarks; print; labels on/off; and Sketch in 3D (4.0 takes Sketch off the toolbar in 3D).

Tests: `python3 atlas-sketch/tests/live-parity.py` runs these tools on the real SDK against MapMaker's own maps (29 checks, with axe-core scans).

## Filter (from 1.15.0-sketch.12)

1.15.0-sketch.13 (Filter 1.1): a condition shows on the map as it's typed or the slider moves, for any field (before, only fields the layer draws with did; others changed the count but not the map until Apply). The panel is tall enough for one condition without scrolling and may reach down over the toolbar. The count stays in view above Apply / Cancel.

Each layer in **Map layers** that holds features has a **Filter** button beside Table. It opens a panel laid out like Map Viewer's filter: the layer's name, *Show features where*, then one or more conditions (field, condition, value), **Add new**, **Clear all**, and **Apply** / **Cancel**.

- **Number fields:** is, is not, is at least, is at most, is greater than, is less than, is between, is blank, is not blank. A histogram of the field's values has a slider on it; the slider and the number box move together, and the bars the condition includes are coloured.
- **Text fields:** is, is not (with the field's own values to choose from), includes, does not include, starts with, ends with, is blank, is not blank.
- **Several conditions** (up to 6) match all or at least one, under *Filter results*.
- **A count** under the conditions says how many features are shown ("Showing 368 of 949 features"). Map Viewer doesn't show one; it's there because the count is often the answer to the question a student is asking.
- **The map follows as you go.** Apply keeps the filter; Cancel, ×, Escape or opening another tool puts the layer back as it was. The Filter button is marked, and named "Filter (on)", when its layer has a filter.
- **Fields offered** are the ones the layer's pop-up shows (under their aliases); if the pop-up has no field list, every number and text field.
- **Spreadsheet (CSV) layers** can be filtered too. All their rows stay in the saved map.

**What it's built from.** Map Viewer's filter panel isn't published as a component, so the panel is assembled from the same standard parts: Esri's Calcite components (`calcite-select`, `calcite-input-number`, `calcite-input-text`, `calcite-combobox`, `calcite-button`) and the SDK's **Histogram** and **Slider** components (`arcgis-histogram` inside `arcgis-slider`, as in Esri's "Histogram Range Slider" sample; these replace the HistogramRangeSlider widget, deprecated in SDK 5.0). The layout, the logic that turns conditions into SQL and back (`lib/filter.js`, Filter 1.1) and the count are this app's.

**How it's saved.** A filter is the layer's `definitionExpression` in the web map (`layerDefinition.definitionExpression`, Web Map Specification), which is how Map Viewer saves one, so the `.amap` still holds only what the specification defines and the filter shows in other ArcGIS apps. Nothing else is stored: when a map is opened, the conditions are read back from that SQL. A filter that was cleared from a layer that came with one is saved as `1=1`, so the layer's original filter doesn't return.

**Known limits**
- **Dates** can't be filtered yet (number and text fields only), and there's no filter by area or distance.
- **A filter written elsewhere** in a form the panel doesn't have (IN lists, functions, AND mixed with OR) is kept as it is and shown as text; conditions added in the panel are added to it, and Clear all leaves it on.
- **A map's own filter can be cleared** by anyone, as in Map Viewer. A map that relies on a filter to hide data shouldn't.
- **Only layers that hold features** have the button (feature, CSV, GeoJSON and WFS layers). Tile, imagery and map-image layers can't be filtered this way.
- **"Apply", not Map Viewer's "Save":** in this app Save means saving the map, and a filter isn't saved until the map is.
- **Switching 2D/3D** while the panel is open closes it without applying.
- **The histogram** needs the field to have a range of values; with one value, or if the components don't load, the number box still works.
- **Tests:** `node atlas-sketch/tests/filter.test.mjs` (the SQL logic and saved time settings, 13 tests) and `python3 atlas-sketch/tests/live-filter.py` (the panel on the real SDK against MapMaker's Major Earthquakes map: 37 checks, with an axe-core scan of the panel).

The working app stays at `https://jsawle.github.io/localmapsave/atlas/` (1.14.8), so the two can be shown side by side.

- **Saved maps** use the same `.amap` format, so a file saved in either app opens in the other. Both apps are on the same site, so *My map files* lists the same maps in both.
- **Sign-in** needs `https://jsawle.github.io/localmapsave/atlas-sketch/oauth-callback.html` added as a redirect URI on the app's client ID in ArcGIS Online. Until then, use sign-in in the main app.
- **Tests** live with the main app in `../atlas/tests/` (on the `sketch-mapviewer` branch for this version). This folder holds only what the page loads.
- **When Sketch moves into the main app**, delete this folder.
