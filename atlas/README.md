# Atlas: a white-label MapMaker

A configurable version of the National Geographic MapMaker app (an Atlas Instant App), built on ArcGIS Maps SDK for JavaScript 5.1. It has the same screen layout and tools, and adds three things MapMaker can't do today:

- **Local save:** save to an `.amap` (Atlas map) file on the device and reopen it later, with no account. The file is a standard ArcGIS web map (see *Saved maps* below).
- **Your own data:** drag and drop a spreadsheet (CSV) and style it with a live preview.
- **ArcGIS Online:** sign in to save the map to your account, update it, and open your own maps.

Version **1.15.0-sketch.2**. Created by Jason Sawle.

**For developers:** the local save and add data logic is packaged on its own, with a minimal example, in [`kit/`](kit/README.md).

## Try it

| Link | What you get |
|---|---|
| `https://jsawle.github.io/localmapsave/atlas/` | Neutral "School Atlas" branding |
| `…/atlas/?config=mapmaker` | MapMaker's groups, units, colours and wording, to compare side by side with the real app. No logos and no name in the header (the browser tab still says National Geographic MapMaker) |
| `…/atlas/?config=example-es` | A Spanish-language version for a distributor (Panama start view) |
| `…/atlas/?webmap=<item id>` | Opens straight into one map (works with any config) |

## Tools

These match MapMaker's configuration (`0cd1cdee853c413a84bfe4b9a6931f0d`).

The toolbar is in MapMaker's order: Basemaps, Open map, Map layers, Add layer, Legend, Measure, Sketch, 2D/3D, Bookmarks, Save.

| Tool | What it does |
|---|---|
| Header | Logo (wide, plus a compact version on tablets and phones), help links, partner logos. The map title with ⓘ (description and credits) appears once a map is open. A Sign in button is optional (`signIn.headerButton`); MapMaker signs in from Save |
| Open map | MapMaker's browser for the collection's maps: search, a **Categories** tree (the content group's categories, with arrows for sub-categories, a reset button, and a Categories button to hide the tree), wide cards with an expandable description, and page numbers. Counts show how many maps each category holds, and the search looks inside the chosen category. Maps whose categories aren't in the group's list appear under *Other*. *My map files* lists every map saved in this browser, newest first, with a picture of each, and *Open a map file* opens any other file (see *Saved maps*). When signed in, *My ArcGIS Online maps*. Plus *Start a new blank map* |
| Add layer | A dialog like MapMaker's: the same browser for the collection's layers, each card with **Add layer** (then **Remove layer**). A second tab, *Your own data*, adds a spreadsheet (CSV). *Your own data*: coordinates can be decimal degrees (51.5, -0.12), with N/S/E/W (51.5N, 0.12W) or in degrees, minutes and seconds (51°30'15"N); a **Swap latitude and longitude** button fixes columns the wrong way round; **pie charts** use the columns ticked (2 to 8; ID-like columns such as "Site ID" or "Year" start unticked), each pie sized by their total; *By type* uses text columns (number columns are always amounts). Excel files get a message to save them as CSV first. Opening another tool before **Add to map** asks *Discard your data?* (**Keep editing** or **Discard data**); Cancel, × and Escape in the panel discard straight away, and opening or starting a map counts the unadded file as unsaved work |
| Map layers | As in MapMaker: each layer has a drag handle, its name, a chevron that shows or hides its tools, and a check box. The tools: **Zoom to**, **Show legend** (the layer's legend under it), **Adjust transparency** (0–100% slider), **Swipe** (2D: the layer shows on the left of a line you drag across the map), **Table** (the layer's attributes docked under the map, with the toolbar tucked away as for Elevation profile), **Layer's description** (from its item), **Labels** (only for layers that have labels) and **Remove** (any layer, straight away). A group opens with its arrow to show its layers, each with the same tools; a group itself has Zoom to, transparency, description and Remove. A layer outside its scale range is greyed, with an ⓘ that says *This layer is not visible at the current map scale*. Drag the handle to change the drawing order, or focus it and use the up and down arrow keys (the new position is announced). The sketch layer stays on top. Order, transparency, labels on/off and removed layers are kept when you save. Spreadsheet (CSV) layers also have a **Change style** button (palette icon) that reopens the styling panel with the layer's current settings: map style, columns, shape, colours, size and labels, with a live preview; **Apply** updates the layer in place (bookmarks still find it), Cancel or Escape leaves it as it was; opening another tool with changes not applied asks *Discard your style changes?* first. It also works for spreadsheet layers in a map opened from a file. As in MapMaker, the button shows how many layers the map has: its top-level layers, so a group counts once (MapMaker shows 6 for "1777-1778 Revolutionary Battles": four layers and two groups). It updates as layers are added or removed |
| Legend | Legend for every layer |
| Basemaps | As in MapMaker: a line of text, then the basemap group as a grid of cards, two to a row, with a picture above each name, in the group's own order (MapMaker's group: date added, newest first). The map's basemap is selected. In 3D the group's 3D basemaps (web scenes) come first. New maps start on the configured default |
| Measure | Opens a small menu above the tool, as in MapMaker: **Measure** (distance, area and coordinates; direct-line distance in 3D) and **Elevation profile**, which docks across the bottom of the screen with the map above it, as in MapMaker. It's ready to draw as soon as it opens: click on the map to start the line, double-click to finish. It shows the height of the land and the sea floor (Esri's World Elevation TopoBathy 3D, credited in the panel) along the line, or along a line you've sketched. The panel is a short strip (under a third of the screen) with the chart on the left and the settings, legend and buttons on the right, so nothing needs scrolling; on phones the buttons come first. While it's open the toolbar is tucked away; the button under the scale bar brings it back |
| Sketch | The SDK's Sketch component, the same drawing toolbar as ArcGIS Map Viewer, shown at the top of the map while the Sketch panel is open: select (click, rectangle or lasso), point, line (straight, freehand, arc and Bezier segments), area, rectangle, circle and text, with undo/redo, duplicate, delete and snapping settings. A finished sketch stays selected, as in Map Viewer. The panel gives the selected sketch a pop-up (title, description and image), colour and size, and rotation for text (the only sketch it turns); with several selected, colour and size change them all. With nothing selected, colour and size set what the tools draw next. Closing the panel hides the toolbar, and clicking a sketch then opens its pop-up |
| Bookmarks | Saves the location and which layers are on. A map's own bookmarks appear when you open it. As in MapMaker, a blue dot on the button shows the map has bookmarks. A bookmark made in 3D brings back the same tilt and heading while the app is open; a saved map keeps its place |
| 2D / 3D | One map shown in either view. Switching to 3D tilts the camera towards the horizon (60° by default) so it's obvious the view has changed. From the whole-world start view the SDK allows almost no tilt (0.5°), so there the globe itself is the change; the tilt shows from about country scale in. The 3D view has zoom and one pan/rotate toggle; the compass rose turns with it |
| Save | Save, Save as, Screenshot, Print. Signed in, the same Save and Save as tiles go to ArcGIS Online (Save overwrites the map's own item, Save as asks for a new name). Save, Save as and ArcGIS Online all write the same web map |
| On the map | Search, Home and zoom (top left); MapMaker's compass rose above the scale bar (bottom left), which turns with the map and faces north again when selected; the disclaimer in the attribution bar; the version (bottom right) |

## Set up a version for your country

Copy `config/default.json` to `config/<name>.json`, edit it, and open `…/atlas/?config=<name>`. To make it your app's default, put your settings in `default.json` on your own copy.

| Setting | What it does |
|---|---|
| `appName` | Name in the browser tab and header (when there's no logo), and in "{app} maps" |
| `showAppName` | `false` leaves the name out of the header (default `true`). The browser tab still uses `appName` |
| `logo.url`, `logo.compactUrl`, `logo.alt`, `logo.link` | Your wide logo, and a narrower one for tablets and phones. None of the configs here ship a logo; without one, the app name shows as text. `showName: true` shows the name next to a logo |
| `headerLinks` | Pill buttons: `{ "label", "url", "style": "dark" or "outline" }`. Outline pills are hidden on tablets and phones |
| `partnerLogos` | Logos on the right of the header: `{ "url", "alt", "link" }` |
| `theme` | `brand` (buttons and links), `toolActive` (open tools and 2D/3D; MapMaker uses `#a0dcff`), `header`, `headerInk`, `pill`, `pillInk`, `font`. Text colours are picked for contrast when you leave them out |
| `portalUrl` | `https://www.arcgis.com` or your organisation's URL (needed for SAML/SSO sign-in) |
| `contentGroup` | Group whose web maps appear in Open map and whose layers appear in Add layer. Its categories become the Categories tree in both. Up to 1,000 items are counted and filtered in the browser; a bigger group is searched in ArcGIS Online, without counts |
| `basemapGroup`, `defaultBasemap` | Basemap gallery group, and the basemap (web map item ID) that new maps start on |
| `startView` | `center` [longitude, latitude] and `zoom` |
| `threeDTilt` | How far the camera tilts when switching to 3D, in degrees (default 60; 0 keeps it looking straight down). The SDK limits tilt by height: 0.5° at the whole-world start view, about 34° at zoom 4, the full 60° from zoom 6 |
| `units`, `scalebar` | `metric` or `imperial` for Measure; `dual`, `metric`, `imperial` or `none` for the scale bar |
| `disclaimer` | Text shown in the attribution bar, before "Powered by Esri" |
| `signIn` | `clientId` (see below), `popup`, `headerButton` (`false` hides Sign in from the header; people sign in from Save), and the sign-in screen's `onboardingTitle` and `onboardingHtml` |
| `agolTags` | Tags added to maps saved to ArcGIS Online |
| `csvMaxRows` | Largest spreadsheet allowed (default 1,000) |
| `features` | Turn tools off: `openMap`, `addLayer`, `csv`, `layers`, `legend`, `basemaps`, `measure`, `sketch`, `bookmarks`, `threeD`, `save`, `localSave`, `screenshot`, `print`, `search`, `signIn`, `compass`, `elevationProfile` |
| `locale`, `dir`, `strings` | Language for the ArcGIS tools (e.g. `es`), text direction (`rtl` for Arabic), and your translation of every word the app shows. `config/example-es.json` has the full list in Spanish, including the compass letters (N, E, S, O) |

Groups should be **public**. Signed-in users can also see content shared with their organisation.

## Saved maps

A saved map is an ArcGIS **web map**: JSON that follows Esri's [Web Map Specification](https://developers.arcgis.com/web-map-specification/) (version 2.31), with only properties the specification defines. Save (an `.amap` file) and Save to ArcGIS Online write exactly the same JSON.

The extension is `.amap`, for the Atlas Instant App the app is modelled on, so it isn't tied to MapMaker. Versions before 1.7 saved the same web map as `.mmap`; those files open as before (choose them in Open a map file, or drop them on the map).

| What's in the map | How it's written |
|---|---|
| The map you opened from the collection | Its own operational layers as they are in Map layers: on/off, transparency, labels on/off (`showLabels`), drawing order, and any you removed (including layers inside a group) left out. The file no longer depends on the collection map staying the same |
| Layers from Add layer | Operational layers that keep their item ID and address (layer id `__item_<item id>`) |
| Your spreadsheet data | A feature collection layer with its style, labels (on or off) and pop-up (layer id `__data_…`) |
| Your sketches | Feature collection layers for points, lines, areas and text (layer ids `__sketch_…`). Pop-ups show the title, description and picture in other ArcGIS apps too |
| Basemap | The full basemap definition |
| View | `initialState.viewpoint`: extent, scale and rotation |
| Bookmarks | `bookmarks`, with a thumbnail. Which layers each one turns on is kept in a matching presentation slide (`presentation.slides`, `visibleLayers`), because a bookmark has no layer list in the specification |

Opening:
- **Any web map JSON** opens: an `.amap` (or older `.mmap`) from this app, or the data of a web map from ArcGIS Online saved to a file. This app's sketches and spreadsheet layers come back editable.
- **Files are checked first.** Layers must load from `https` addresses and be a layer type the specification defines. Pictures must be embedded or come from `https`. Picture symbols that would load from anywhere else are replaced, and files are capped at 5,000 features. Anything left out is counted in a message.
- **Older `.mmap` files** still open: web maps saved by versions 1.2 to 1.6, and the older document format from before 1.2.
- A web map is a 2D document, so saved maps reopen in 2D.
- A web map file has no title of its own: a saved map is named by its file. After saving, the header shows the file's name, and *My map files* lists the map under it, so both match what reopening shows.

**Signed in.** Save and Save as save to ArcGIS Online instead of a file. Save overwrites the map's own item (one you own: made here, or opened from My ArcGIS Online maps); with no item yet, or one that isn't yours, it asks for a name like Save as, which always makes a new item and takes the name you type. The saved message links the item page. Opening a saved `.amap` file still works, so a map started on a device can be finished and saved to the account. The reason for the split: a signed-in user can have layers only their account can see, and a file would carry those outside ArcGIS Online's access control. So:
- A map opened from a private ArcGIS Online map while signed in never has its layers written to a file, even after signing out (the sketches and spreadsheet data still are). The app says how many were left out.
- The file never holds an ArcGIS Online item ID. A starter file posted by a teacher therefore can't point a student's Save at the teacher's item. Save only overwrites an item the signed-in user owns.
- Saving needs a role with the create-content privilege. If the portal says the role lacks it, the app says so instead of failing.
- After Save to ArcGIS Online the map counts as saved, so closing the tab doesn't ask about unsaved changes.

**My map files.** Every save also puts the map in a list kept in this browser, which Open map shows under *My map files*: title, when it was saved, the file name and a picture of the map, newest first (up to 30). Saving the same file again updates its entry; Save as adds a new one.
- **Chrome and Edge** keep a link to the file itself. Open reads the file as it is now (the browser may ask once whether the app can open it again), and Save then goes on writing to that file. If the file has been moved, renamed or deleted, the app says so.
- **Safari and Firefox** can only download, and can't open a file again by themselves, so the list keeps a copy of each map saved, in the browser on this device. The downloaded file is the same map.
- **Remove from list** takes a map off the list. It never deletes the file (in Safari and Firefox it deletes the browser's copy).
- The list belongs to one browser on one device, and each config has its own list.

## Sign-in setup (once per web address)

Esri's own sign-in ID only works on arcgis.com, so a copy hosted anywhere else needs its own client ID.

1. In ArcGIS Online, go to **Content → New item → Application → Other application** and give it a title.
2. Under **Redirect URIs**, add this app's `oauth-callback.html` address, for example `https://jsawle.github.io/localmapsave/atlas/oauth-callback.html`. Add one per place the app is hosted, such as the Esri S3/CloudFront copy.
3. Copy the **Client ID** into `signIn.clientId` in the config.

Notes:
- Sign-in opens in a pop-up, so work on the map isn't lost. If a school blocks pop-ups, the app says so.
- Setting `"popup": false` uses a full-page redirect instead. The app keeps unsaved work in the browser tab while you sign in. You then also need to register the page address itself (`…/atlas/` and `…/atlas/index.html`).
- Put the registration under an account that will last, such as a team account, not a personal one.

## Privacy

- **Without sign-in:** nothing a student adds, draws or saves leaves the device. CSV files are read in the browser, and saved maps are files on the device. Printing happens in the browser, so no print service is used.
- **The saved-maps list** stays in the browser on the device (in Safari and Firefox with a copy of each map). Anyone using the same browser on the same device can see it, which the list itself says; *Remove from list* clears an entry.
- **What the app does load:** basemap tiles and collection content come from ArcGIS Online, and search terms go to Esri's geocoder.
- **With sign-in:** saving to ArcGIS Online creates a private item that only the signed-in user can see. Signing in is optional and is never asked for: the map, CSV data and saving to a device all work without it. Without sign-in the statements above hold; with it, the account belongs to the user's organization.
- **Opening a saved map loads its layers** from the web addresses written in it (only `https`). A file from someone else can therefore contact the servers its layers come from, just as a web map in ArcGIS Online does.
- **Opened files are checked first** (see *Saved maps*).

## Accessibility (WCAG 2.1 AA / Section 508)

- Every control can be reached and used by keyboard.
- Escape closes the top dialog or panel and returns focus to the button that opened it. Focus stays inside dialogs while they're open.
- Toolbar buttons report open/closed and on/off states. Messages are read out by screen readers.
- The layer count and the bookmarks dot are part of the buttons' names for screen readers ("Map layers, 6 layers", "Bookmarks, 1 bookmark"), and stay visible in Windows high-contrast mode.
- Map layers: every tool is a button named with its layer ("Swipe: Revolutionary War Battles"); Show legend, transparency, Swipe, Table, description and Labels say whether they're on (`aria-pressed`). Reordering never needs dragging: the handle moves a layer with the up and down arrow keys and the new position is announced. Greyed names (off, or out of scale) stay at 5:1 contrast or more, lighter than MapMaker's grey for that reason.
- In Open map and Add layer, each category's name includes its number of maps or layers, the arrow buttons say which branch they open, page buttons are labelled, the result count is announced when the list changes, and changing page moves focus to the list.
- The compass is a button whose name says which way the map faces.
- Measure opens a menu: arrow keys move between Measure and Elevation profile, and Escape closes it and returns to the tool.
- There's a skip link, and focus is always visible.
- Theme text colours are chosen to reach 4.5:1 contrast.
- The page can be zoomed, and it respects "reduce motion".
- Basemap cards are buttons that report which one is chosen; arrow keys move across and down the grid.
- Saved maps: each card's buttons name the map ("Open map: …", "Remove from list: …"), and removing one moves focus to the next.
- The app's own screens, including Open map, My map files and Basemaps, were scanned with axe-core for WCAG 2.0/2.1 A and AA: no violations, for all three configs and against the live services.
- Esri's widgets (Search, Legend, Measure) follow Esri's own accessibility work.

## Versions

The app version, plus a version for each part, is shown under the version button at the bottom right of the map.

| Part | Version |
|---|---|
| App | 1.15.0-sketch.2 (branch `sketch-mapviewer`): freehand segments in the line and area tools. 1.15.0-sketch.1: Sketch uses the SDK's Sketch component (Map Viewer's tools) instead of the app's own tool buttons. 1.14.2: Open map tabs renamed to *My map files* and *My ArcGIS Online maps* (a saved map may be on a school drive or USB stick, not this device); *Open a map file* is now *Open a map file*, and the save notes no longer say “on this device”. 1.14.1: the page loads app.js and its modules with the version in the address, so after a release a browser can't run the new page with an older cached script (which left Save and Save as doing nothing for a signed-in user). 1.14.0: signed in, Save overwrites the map's ArcGIS Online item and Save as opens a name dialog for a new one (the separate Save to ArcGIS Online and Update buttons and the Map Viewer link are gone). 1.13.2: after Save to ArcGIS Online the map's title shows in the header. 1.13.1: the sign-in client ID is set in the default and MapMaker configs (the example-es config stays blank: each distributor registers their own). 1.13.0: signed in, Save goes to ArcGIS Online and the file Save and Save as are hidden (opening a file still works); a map opened from a private ArcGIS Online map never has its layers written to a file; the map counts as saved after Save to ArcGIS Online; a role that can't create items is told so. 1.12.0: MapMaker's layer tools in Map layers (drag to reorder, show/hide tools, Zoom to, legend, transparency, Swipe, Table, description, Labels, Remove; groups open to their layers; out-of-scale ⓘ). 1.11.0: opening another tool while Add data or Change style has unfinished work asks before discarding it (replaces 1.10.0's set-aside data and dot on Add layer). 1.9.1: *By type* is for text columns only again; saved maps are shown under their file's name. 1.9.0: fixes from Esri's code review (CSV coordinates, swap, pie columns; rotation; US wording; 3D bookmarks; newer-file warning) |
| Basemaps | 2.0: MapMaker's card grid (1.x was Esri's Basemap Gallery widget) |
| Saved maps list (Open map, My map files) | 1.0 |
| Collection browser (Open map, Add layer) | 2.0 |
| Compass | 1.0 |
| Elevation profile | 2.0: land and sea floor (TopoBathy 3D), ready to draw on opening |
| Saved map (.amap and ArcGIS Online) | 2.1: layers in the map's drawing order, labels on/off. 2.0: a web map (Web Map Specification 2.31) |
| Older .mmap files (open only) | 4. Also opens versions 2 and 3 from the local-save concept, and Map Studio files |
| CSV import | 3.3: N/S/E/W and degrees-minutes-seconds, pie columns, stray quotes inside a cell read as text; *By type* from text columns only |
| Sketch | 2.1: freehand segments in the line and area tools (in 3D, separate freehand buttons). 2.0: the SDK's Sketch component (Map Viewer's drawing toolbar) replaces the app's own tools; curves are saved as lines through close points. 1.1: rotation for text only |
| Config schema | 1 |

## Known limits

- **Esri widgets:** Measure, Elevation profile, Legend, Swipe, Table, Search, Home and Scale bar use Esri widgets (Sketch uses the newer Sketch component). Esri marks these as deprecated from SDK 5.0 in favour of web components. They work in 5.1 but should move to components in a later version.
- **Pie-chart layers** only draw in 2D.
- **Swipe** works in 2D only (the SDK's Swipe is for 2D maps), so the button isn't shown in 3D and switching to 3D ends a swipe.
- **Table** uses Esri's FeatureTable widget (also deprecated from SDK 5.0 in favour of a component). With the map view attached, as here so rows selected in the table are highlighted on the map, SDK 5.1 logs an unhandled error in the browser console for each layer in the map that failed to load. Nothing shows to the user.
- **Layer's description** comes from the layer's item. A group without an item, and a layer added from a spreadsheet, say so instead.
- **The sketch layer** (My sketches) has Zoom to only, and can't be dragged: it always draws on top, as before.
- **Sketch styling:** Map Viewer's styling panel (stamps, line patterns, arrows) isn't part of the SDK, so the panel keeps this app's colour and size. Saved maps still store each sketch as before, so files from 1.14 and this version open in either.
- **Curved lines and areas:** the line tools can draw arcs and Bezier curves. The 3D view can't draw true curves, so when a sketch is finished its curves become a line through many close points (within 2°). Reshaping it later moves those points, not a curve handle.
- **Undo** covers the drawing or editing in progress (the SDK's own undo). A sketch deleted with the Delete button can't be brought back with Undo.
- **3D sketching:** the SDK offers click selection only (no rectangle or lasso) and draws without the curve tools.
- **Hemisphere letters** are N, S, E and W only. "O" for west (Spanish, French) isn't read, because in German "O" means east (Ost).
- **3D bookmarks** keep their tilt and heading only while the app is open. The web map specification's bookmark viewpoint hasn't been confirmed to allow a camera, and saved maps keep to the specification.
- **A map saved by a newer version** of the app opens with a note that some parts may not show.
- **Choosing a folder** for local save needs Chrome or Edge. Safari and Firefox save to Downloads instead.
- **Private browsing:** in Playwright's private-mode test sessions, Chromium crashes when it reads a stored file link back from browser storage (normal profiles are fine). The list therefore never reads those links to show itself, only to open the one map chosen. Real Chrome Incognito hasn't been tried; in a private window the list is in any case wiped when the window closes.
- **3D basemaps in 2D:** the group's 3D Buildings basemap is only offered in 3D. If it's chosen and the map goes back to 2D, its 2D layers still show; its 3D layers can't draw in 2D (the browser console notes this).
- **Private layers inside a public map:** a signed-in user's map is treated as private when its item isn't public. A public web map that includes a secured layer isn't detected, so after signing out that layer's address could still be written to a file. Checking each layer's own access needs a test in a real browser.
- **Maps reopened from ArcGIS Online:** the sketches and spreadsheet data the app wrote come back fully editable. Other apps see them as ordinary layers.
- **3D animations** (the Vesuvius plug-in) are in Map Studio (`../whitelabel/`) and not in this app yet.

## Tests

- `node atlas/tests/run.mjs` runs the unit tests for CSV import, saved maps (web map writing, reading and file checks), categories and page numbers.
- `python3 atlas/tests/smoke/smoke.py` runs a browser test of all three configs (Python Playwright with Chromium). It uses a stand-in for the ArcGIS library, Esri's real Calcite icons, fixture data shaped like the MapMaker group, and an axe-core scan.
- `python3 atlas/tests/real-sdk/real.py` runs the app on the real ArcGIS library (5.1.0 from npm, about 400 MB on first run) in Chromium, offline: ArcGIS Online is answered with the smoke test's fixtures and plain tiles. It checks what the stand-in can't: the basemap draws in 2D and 3D, the 3D controls, the tilt, the Map layers count for a map shaped like Revolutionary Battles (and that it follows layers being removed and added), the Elevation profile (ready to draw on opening, sampling TopoBathy 3D, every control on screen without scrolling at desktop and phone sizes), and no uncaught errors. It takes a few minutes, because 3D runs on software WebGL. Version 1.3.1 failed it (no basemap in 3D); the stand-in now copies that SDK behaviour too.
- `python3 atlas/tests/live/live.py` runs the app against the real services: the ArcGIS library from Esri's CDN and ArcGIS Online itself (needs network access; an HTTPS proxy is taken from `HTTPS_PROXY`). It checks Basemaps against the live group (order, MapMaker's sizes and spacing at 125% screen scale, choosing by mouse and keyboard, 3D) and *My map files* both ways: Chrome and Edge (file links; the save and open dialogs are answered with files in the page's private file system, which are real file handles) and browsers that only download, plus phone layouts and axe-core scans.
- Toolbar icons are Esri's Calcite icons, loaded by the ArcGIS library; built-in outline icons show until they load.
