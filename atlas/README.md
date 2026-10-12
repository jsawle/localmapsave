# Atlas: a white-label MapMaker

A configurable version of the National Geographic MapMaker app (an Atlas Instant App), built on ArcGIS Maps SDK for JavaScript 5.1. It has the same screen layout and tools, and adds three things MapMaker can't do today:

- **Local save:** save to a `.mmap` file on the device and reopen it later, with no account. The file is a standard ArcGIS web map (see *Saved maps* below).
- **Your own data:** drag and drop a spreadsheet (CSV) and style it with a live preview.
- **ArcGIS Online:** sign in to save the map to your account, update it, and open your own maps.

Version **1.2.0**. Created by Jason Sawle.

## Try it

| Link | What you get |
|---|---|
| `https://jsawle.github.io/localmapsave/atlas/` | Neutral "School Atlas" branding |
| `…/atlas/?config=mapmaker` | MapMaker's groups, units, colours and wording, to compare side by side with the real app. No logos: the name shows as text |
| `…/atlas/?config=example-es` | A Spanish-language version for a distributor (Panama start view) |
| `…/atlas/?webmap=<item id>` | Opens straight into one map (works with any config) |

## Tools

These match MapMaker's configuration (`0cd1cdee853c413a84bfe4b9a6931f0d`).

The toolbar is in MapMaker's order: Basemaps, Open map, Map layers, Add layer, Legend, Measure, Sketch, 2D/3D, Bookmarks, Save.

| Tool | What it does |
|---|---|
| Header | Logo (wide, plus a compact version on tablets and phones), help links, partner logos. The map title with ⓘ (description and credits) appears once a map is open. A Sign in button is optional (`signIn.headerButton`); MapMaker signs in from Save |
| Open map | Browse the collection by **topic**: the content group's categories, with the number of maps in each. Choosing a topic shows its sub-topics as chips, and the search looks inside the chosen topic. Maps whose categories aren't in the group's list appear under *Other maps*. Also maps on this device and, when signed in, *My ArcGIS maps*. Plus *Start a new blank map* |
| Add layer | Layers from the collection, with search and topics. Also *Your own data* (CSV) |
| Map layers | Turn layers on and off, zoom to a layer, remove layers you added |
| Legend | Legend for every layer |
| Basemaps | The basemap group, starting on the configured default |
| Measure | Opens a small menu above the tool, as in MapMaker: **Measure** (distance, area and coordinates; direct-line distance in 3D) and **Elevation profile** (the ground's height along a line you draw or a line you've sketched) |
| Sketch | Point, line, area, circle and text. Each has a pop-up with title, description and image, plus colour, size and rotation. Select to move or reshape; delete |
| Bookmarks | Saves the location and which layers are on. A map's own bookmarks appear when you open it |
| 2D / 3D | One map shown in either view |
| Save | Save, Save as, Screenshot, Print. With sign-in: Save to ArcGIS Online and Update. Save and Save to ArcGIS Online write the same web map |
| On the map | Search, Home and zoom (top left); MapMaker's compass rose above the scale bar (bottom left), which turns with the map and faces north again when selected; the disclaimer in the attribution bar; version and credit (bottom right) |

## Set up a version for your country

Copy `config/default.json` to `config/<name>.json`, edit it, and open `…/atlas/?config=<name>`. To make it your app's default, put your settings in `default.json` on your own copy.

| Setting | What it does |
|---|---|
| `appName` | Name in the browser tab and header (when there's no logo), and in "{app} maps" |
| `logo.url`, `logo.compactUrl`, `logo.alt`, `logo.link` | Your wide logo, and a narrower one for tablets and phones. None of the configs here ship a logo; without one, the app name shows as text. `showName: true` shows the name next to a logo |
| `headerLinks` | Pill buttons: `{ "label", "url", "style": "dark" or "outline" }`. Outline pills are hidden on tablets and phones |
| `partnerLogos` | Logos on the right of the header: `{ "url", "alt", "link" }` |
| `theme` | `brand` (buttons and links), `toolActive` (open tools, 2D/3D and the chosen topic; MapMaker uses `#a0dcff`), `header`, `headerInk`, `pill`, `pillInk`, `font`. Text colours are picked for contrast when you leave them out |
| `portalUrl` | `https://www.arcgis.com` or your organisation's URL (needed for SAML/SSO sign-in) |
| `contentGroup` | Group whose web maps appear in Open map and whose layers appear in Add layer. Its categories become the topics in Open map. Up to 1,000 web maps are counted and filtered in the browser; a bigger group is filtered by ArcGIS Online, without counts |
| `basemapGroup`, `defaultBasemap` | Basemap gallery group, and the basemap (web map item ID) that new maps start on |
| `startView` | `center` [longitude, latitude] and `zoom` |
| `units`, `scalebar` | `metric` or `imperial` for Measure; `dual`, `metric`, `imperial` or `none` for the scale bar |
| `disclaimer` | Text shown in the attribution bar, before "Powered by Esri" |
| `signIn` | `clientId` (see below), `popup`, `headerButton` (`false` hides Sign in from the header; people sign in from Save), and the sign-in screen's `onboardingTitle` and `onboardingHtml` |
| `agolTags` | Tags added to maps saved to ArcGIS Online |
| `csvMaxRows` | Largest spreadsheet allowed (default 1,000) |
| `features` | Turn tools off: `openMap`, `addLayer`, `csv`, `layers`, `legend`, `basemaps`, `measure`, `sketch`, `bookmarks`, `threeD`, `save`, `localSave`, `screenshot`, `print`, `search`, `signIn`, `compass`, `elevationProfile` |
| `locale`, `dir`, `strings` | Language for the ArcGIS tools (e.g. `es`), text direction (`rtl` for Arabic), and your translation of every word the app shows. `config/example-es.json` has the full list in Spanish, including the compass letters (N, E, S, O) |

Groups should be **public**. Signed-in users can also see content shared with their organisation.

## Saved maps

A saved map is an ArcGIS **web map**: JSON that follows Esri's [Web Map Specification](https://developers.arcgis.com/web-map-specification/) (version 2.31), with only properties the specification defines. Save (a `.mmap` file) and Save to ArcGIS Online write exactly the same JSON.

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
- **Any web map JSON** opens: a `.mmap` from this app, or the data of a web map from ArcGIS Online saved to a file. This app's sketches and spreadsheet layers come back editable.
- **Files are checked first.** Layers must load from `https` addresses and be a layer type the specification defines. Pictures must be embedded or come from `https`. Picture symbols that would load from anywhere else are replaced, and files are capped at 5,000 features. Anything left out is counted in a message.
- **Older `.mmap` files** (saved before version 1.2) still open.
- A web map is a 2D document, so saved maps reopen in 2D.

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
- **What the app does load:** basemap tiles and collection content come from ArcGIS Online, and search terms go to Esri's geocoder.
- **With sign-in:** saving to ArcGIS Online creates a private item that only the signed-in user can see.
- **Opening a saved map loads its layers** from the web addresses written in it (only `https`). A file from someone else can therefore contact the servers its layers come from, just as a web map in ArcGIS Online does.
- **Opened files are checked first** (see *Saved maps*).

## Accessibility (WCAG 2.1 AA / Section 508)

- Every control can be reached and used by keyboard.
- Escape closes the top dialog or panel and returns focus to the button that opened it. Focus stays inside dialogs while they're open.
- Toolbar buttons report open/closed and on/off states. Messages are read out by screen readers.
- In Open map, arrow keys move along the topics list, each topic's name includes its number of maps, and the map count is announced when the list changes.
- The compass is a button whose name says which way the map faces.
- Measure opens a menu: arrow keys move between Measure and Elevation profile, and Escape closes it and returns to the tool.
- There's a skip link, and focus is always visible.
- Theme text colours are chosen to reach 4.5:1 contrast.
- The page can be zoomed, and it respects "reduce motion".
- The app's own screens, including Open map, were scanned with axe-core for WCAG 2.0/2.1 A and AA: no violations, for all three configs.
- Esri's widgets (Search, Legend, Basemaps, Measure) follow Esri's own accessibility work.

## Versions

The app version, plus a version for each part, is shown under the version button at the bottom right of the map.

| Part | Version |
|---|---|
| App | 1.2.0 |
| Open map topics | 1.0 |
| Compass | 1.0 |
| Elevation profile | 1.0 |
| Saved map (.mmap and ArcGIS Online) | 2.0: a web map (Web Map Specification 2.31) |
| Older .mmap files (open only) | 4. Also opens versions 2 and 3 from the local-save concept, and Map Studio files |
| CSV import | 3.0 |
| Sketch | 1.0 |
| Config schema | 1 (configs are at version 3) |

## Known limits

- **Esri widgets:** Measure, Elevation profile, Legend, Search, Basemap gallery, Home and Scale bar use Esri widgets. Esri marks these as deprecated from SDK 5.0 in favour of web components. They work in 5.1 but should move to components in a later version.
- **Pie-chart layers** only draw in 2D.
- **Choosing a folder** for local save needs Chrome or Edge. Safari and Firefox save to Downloads instead.
- **Maps reopened from ArcGIS Online:** the sketches and spreadsheet data the app wrote come back fully editable. Other apps see them as ordinary layers.
- **3D animations** (the Vesuvius plug-in) are in Map Studio (`../whitelabel/`) and not in this app yet.

## Tests

- `node atlas/tests/run.mjs` runs the unit tests for CSV import, saved maps (web map writing, reading and file checks) and Open map topics.
- `python3 atlas/tests/smoke/smoke.py` runs a browser test of all three configs (Python Playwright with Chromium). It uses a stand-in for the ArcGIS library, Esri's real Calcite icons, fixture data shaped like the MapMaker group, and an axe-core scan.
- Toolbar icons are Esri's Calcite icons, loaded by the ArcGIS library; built-in outline icons show until they load.
