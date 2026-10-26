# Atlas: a white-label MapMaker

A configurable version of the National Geographic MapMaker app (an Atlas Instant App), built on ArcGIS Maps SDK for JavaScript 5.1. It has the same screen layout and tools, and adds three things MapMaker can't do today:

- **Local save:** save to an `.amap` (Atlas map) file on the device and reopen it later, with no account. The file is a standard ArcGIS web map (see *Saved maps* below).
- **Your own data:** drag and drop a spreadsheet (CSV) and style it with a live preview.
- **ArcGIS Online:** sign in to save the map to your account, update it, and open your own maps.

Version **1.8.0**. Created by Jason Sawle.

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
| Open map | MapMaker's browser for the collection's maps: search, a **Categories** tree (the content group's categories, with arrows for sub-categories, a reset button, and a Categories button to hide the tree), wide cards with an expandable description, and page numbers. Counts show how many maps each category holds, and the search looks inside the chosen category. Maps whose categories aren't in the group's list appear under *Other*. *On this device* lists every map saved in this browser, newest first, with a picture of each, and *Browse this device* opens any other file (see *Saved maps*). When signed in, *My ArcGIS maps*. Plus *Start a new blank map* |
| Add layer | A dialog like MapMaker's: the same browser for the collection's layers, each card with **Add layer** (then **Remove layer**). A second tab, *Your own data*, adds a spreadsheet (CSV) |
| Map layers | Turn layers on and off, zoom to a layer, remove layers you added. Spreadsheet (CSV) layers have a **Change style** button (palette icon) that reopens the styling panel with the layer's current settings: map style, columns, shape, colours, size and labels, with a live preview; **Apply** updates the layer in place (bookmarks still find it), Cancel or Escape leaves it as it was. It also works for spreadsheet layers in a map opened from a file. As in MapMaker, the button shows how many layers the map has: its top-level layers, so a group counts once (MapMaker shows 6 for "1777-1778 Revolutionary Battles": four layers and two groups). It updates as layers are added or removed |
| Legend | Legend for every layer |
| Basemaps | As in MapMaker: a line of text, then the basemap group as a grid of cards, two to a row, with a picture above each name, in the group's own order (MapMaker's group: date added, newest first). The map's basemap is selected. In 3D the group's 3D basemaps (web scenes) come first. New maps start on the configured default |
| Measure | Opens a small menu above the tool, as in MapMaker: **Measure** (distance, area and coordinates; direct-line distance in 3D) and **Elevation profile**, which docks across the bottom of the screen with the map above it, as in MapMaker. It's ready to draw as soon as it opens: click on the map to start the line, double-click to finish. It shows the height of the land and the sea floor (Esri's World Elevation TopoBathy 3D, credited in the panel) along the line, or along a line you've sketched. The panel is a short strip (under a third of the screen) with the chart on the left and the settings, legend and buttons on the right, so nothing needs scrolling; on phones the buttons come first. While it's open the toolbar is tucked away; the button under the scale bar brings it back |
| Sketch | Point, line, area, circle and text. Each has a pop-up with title, description and image, plus colour, size and rotation. Select to move or reshape; delete |
| Bookmarks | Saves the location and which layers are on. A map's own bookmarks appear when you open it. As in MapMaker, a blue dot on the button shows the map has bookmarks |
| 2D / 3D | One map shown in either view. Switching to 3D tilts the camera towards the horizon (60° by default) so it's obvious the view has changed. From the whole-world start view the SDK allows almost no tilt (0.5°), so there the globe itself is the change; the tilt shows from about country scale in. The 3D view has zoom and one pan/rotate toggle; the compass rose turns with it |
| Save | Save, Save as, Screenshot, Print. With sign-in: Save to ArcGIS Online and Update. Save and Save to ArcGIS Online write the same web map |
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

The extension is `.amap`, for the Atlas Instant App the app is modelled on, so it isn't tied to MapMaker. Versions before 1.7 saved the same web map as `.mmap`; those files open as before (choose them in Browse this device, or drop them on the map).

| What's in the map | How it's written |
|---|---|
| The map you opened from the collection | Its own operational layers, with your layers on/off and transparency. The file no longer depends on the collection map staying the same |
| Layers from Add layer | Operational layers that keep their item ID and address (layer id `__item_<item id>`) |
| Your spreadsheet data | A feature collection layer with its style, labels and pop-up (layer id `__data_…`) |
| Your sketches | Feature collection layers for points, lines, areas and text (layer ids `__sketch_…`). Pop-ups show the title, description and picture in other ArcGIS apps too |
| Basemap | The full basemap definition |
| View | `initialState.viewpoint`: extent, scale and rotation |
| Bookmarks | `bookmarks`, with a thumbnail. Which layers each one turns on is kept in a matching presentation slide (`presentation.slides`, `visibleLayers`), because a bookmark has no layer list in the specification |

Opening:
- **Any web map JSON** opens: an `.amap` (or older `.mmap`) from this app, or the data of a web map from ArcGIS Online saved to a file. This app's sketches and spreadsheet layers come back editable.
- **Files are checked first.** Layers must load from `https` addresses and be a layer type the specification defines. Pictures must be embedded or come from `https`. Picture symbols that would load from anywhere else are replaced, and files are capped at 5,000 features. Anything left out is counted in a message.
- **Older `.mmap` files** still open: web maps saved by versions 1.2 to 1.6, and the older document format from before 1.2.
- A web map is a 2D document, so saved maps reopen in 2D.

**On this device.** Every save also puts the map in a list kept in this browser, which Open map shows under *On this device*: title, when it was saved, the file name and a picture of the map, newest first (up to 30). Saving the same file again updates its entry; Save as adds a new one.
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
- **With sign-in:** saving to ArcGIS Online creates a private item that only the signed-in user can see.
- **Opening a saved map loads its layers** from the web addresses written in it (only `https`). A file from someone else can therefore contact the servers its layers come from, just as a web map in ArcGIS Online does.
- **Opened files are checked first** (see *Saved maps*).

## Accessibility (WCAG 2.1 AA / Section 508)

- Every control can be reached and used by keyboard.
- Escape closes the top dialog or panel and returns focus to the button that opened it. Focus stays inside dialogs while they're open.
- Toolbar buttons report open/closed and on/off states. Messages are read out by screen readers.
- The layer count and the bookmarks dot are part of the buttons' names for screen readers ("Map layers, 6 layers", "Bookmarks, 1 bookmark"), and stay visible in Windows high-contrast mode.
- In Open map and Add layer, each category's name includes its number of maps or layers, the arrow buttons say which branch they open, page buttons are labelled, the result count is announced when the list changes, and changing page moves focus to the list.
- The compass is a button whose name says which way the map faces.
- Measure opens a menu: arrow keys move between Measure and Elevation profile, and Escape closes it and returns to the tool.
- There's a skip link, and focus is always visible.
- Theme text colours are chosen to reach 4.5:1 contrast.
- The page can be zoomed, and it respects "reduce motion".
- Basemap cards are buttons that report which one is chosen; arrow keys move across and down the grid.
- Saved maps: each card's buttons name the map ("Open map: …", "Remove from list: …"), and removing one moves focus to the next.
- The app's own screens, including Open map, On this device and Basemaps, were scanned with axe-core for WCAG 2.0/2.1 A and AA: no violations, for all three configs and against the live services.
- Esri's widgets (Search, Legend, Measure) follow Esri's own accessibility work.

## Versions

The app version, plus a version for each part, is shown under the version button at the bottom right of the map.

| Part | Version |
|---|---|
| App | 1.8.0: change a spreadsheet layer's style from Map layers |
| Basemaps | 2.0: MapMaker's card grid (1.x was Esri's Basemap Gallery widget) |
| Saved maps list (Open map, On this device) | 1.0 |
| Collection browser (Open map, Add layer) | 2.0 |
| Compass | 1.0 |
| Elevation profile | 2.0: land and sea floor (TopoBathy 3D), ready to draw on opening |
| Saved map (.amap and ArcGIS Online) | 2.0: a web map (Web Map Specification 2.31) |
| Older .mmap files (open only) | 4. Also opens versions 2 and 3 from the local-save concept, and Map Studio files |
| CSV import | 3.1: a layer's style can be changed after it's added |
| Sketch | 1.0 |
| Config schema | 1 |

## Known limits

- **Esri widgets:** Measure, Elevation profile, Legend, Search, Home and Scale bar use Esri widgets. Esri marks these as deprecated from SDK 5.0 in favour of web components. They work in 5.1 but should move to components in a later version.
- **Pie-chart layers** only draw in 2D.
- **Choosing a folder** for local save needs Chrome or Edge. Safari and Firefox save to Downloads instead.
- **Private browsing:** in Playwright's private-mode test sessions, Chromium crashes when it reads a stored file link back from browser storage (normal profiles are fine). The list therefore never reads those links to show itself, only to open the one map chosen. Real Chrome Incognito hasn't been tried; in a private window the list is in any case wiped when the window closes.
- **3D basemaps in 2D:** the group's 3D Buildings basemap is only offered in 3D. If it's chosen and the map goes back to 2D, its 2D layers still show; its 3D layers can't draw in 2D (the browser console notes this).
- **Maps reopened from ArcGIS Online:** the sketches and spreadsheet data the app wrote come back fully editable. Other apps see them as ordinary layers.
- **3D animations** (the Vesuvius plug-in) are in Map Studio (`../whitelabel/`) and not in this app yet.

## Tests

- `node atlas/tests/run.mjs` runs the unit tests for CSV import, saved maps (web map writing, reading and file checks), categories and page numbers.
- `python3 atlas/tests/smoke/smoke.py` runs a browser test of all three configs (Python Playwright with Chromium). It uses a stand-in for the ArcGIS library, Esri's real Calcite icons, fixture data shaped like the MapMaker group, and an axe-core scan.
- `python3 atlas/tests/real-sdk/real.py` runs the app on the real ArcGIS library (5.1.0 from npm, about 400 MB on first run) in Chromium, offline: ArcGIS Online is answered with the smoke test's fixtures and plain tiles. It checks what the stand-in can't: the basemap draws in 2D and 3D, the 3D controls, the tilt, the Map layers count for a map shaped like Revolutionary Battles (and that it follows layers being removed and added), the Elevation profile (ready to draw on opening, sampling TopoBathy 3D, every control on screen without scrolling at desktop and phone sizes), and no uncaught errors. It takes a few minutes, because 3D runs on software WebGL. Version 1.3.1 failed it (no basemap in 3D); the stand-in now copies that SDK behaviour too.
- `python3 atlas/tests/live/live.py` runs the app against the real services: the ArcGIS library from Esri's CDN and ArcGIS Online itself (needs network access; an HTTPS proxy is taken from `HTTPS_PROXY`). It checks Basemaps against the live group (order, MapMaker's sizes and spacing at 125% screen scale, choosing by mouse and keyboard, 3D) and *On this device* both ways: Chrome and Edge (file links; the save and open dialogs are answered with files in the page's private file system, which are real file handles) and browsers that only download, plus phone layouts and axe-core scans.
- Toolbar icons are Esri's Calcite icons, loaded by the ArcGIS library; built-in outline icons show until they load.
