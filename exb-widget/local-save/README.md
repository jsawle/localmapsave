# Local Save widget (Experience Builder Developer Edition)

Version 1.0.0 · file format 1.0 · Created by Jason Sawle

Saves the current 2D map to a file on the user's device and opens it again later.
The file (`.amap`) is standard **ArcGIS web map JSON**, so `WebMap.fromJSON()` can read it
and developers can open and inspect it. No ArcGIS account, item, hosted layer or credit is used.

## Install

1. Copy the `local-save` folder to `client/your-extensions/widgets/`.
2. In `manifest.json`, set `exbVersion` to your framework version (`client/package.json`, `exb-client` version). It ships as `1.21.0`.
3. Restart the client (`npm start` in `client/`), refresh the builder, and add **Local Save** from the widget panel.
4. In its settings, choose the map widget. Run `npm run tscheck` in `client/` to confirm it compiles.

## What users see

- **Open…**, **Save**, **Save as…**, the current file name and an "Unsaved changes" line.
- After opening a file that came from someone else (for example a lesson file from the LMS), the first **Save** asks:
  *Save my own copy…* or *Update the original*. This protects shared files without needing user roles.
- Opening while there are unsaved changes asks first. The browser also warns before leaving the page (setting).
- Status and errors are announced to screen readers (`role="status"` / `role="alert"`).

## What is saved

| In the map | Saved as |
|---|---|
| Feature/map image/tile/imagery/vector tile/WMS/web tile layers from services | Layer reference (URL or item id) + visibility, opacity, style, labels, pop-up, filter |
| Data added from a file at run time (Add Data widget CSV, shapefile, GeoJSON) | Feature collection (the data itself) with style, labels and pop-up |
| Drawings (Draw widget graphics layers) | Feature collection; each distinct symbol kept; text kept as labels |
| Group layers | Group with saved children |
| Basemap, view position | `baseMap`, `initialState.viewpoint` |

Not saved: stream/scene/other unusual layer types, KML added from a local file, ExB bookmarks
(the Bookmark widget stores its own). The widget lists anything it left out after saving.
Reopened drawings come back as a normal layer, so the Draw widget cannot edit them again.

## Opening files from other people (safety)

- Only `https://` layer and basemap links are loaded. `http:`, `blob:`, `data:` and other links are dropped.
- Feature counts are capped per layer (setting), and files over the size limit are not opened.
- 3D web scenes and non-map files are rejected with a clear message.
- The live map is never replaced. Layers that match are updated, missing ones are added,
  extra ones are removed. Hidden helper layers are left alone, and drawing layers are cleared rather than removed.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Map | none | Required |
| Save drawings | on | |
| Warn before leaving with unsaved changes | on | |
| Follow ArcGIS user type when signed in | on | Signed-in users without the *create content* privilege (for example Viewers) can open files but not save them. Anonymous users can always save. |
| Most features per layer | 5000 | Applies to saving and opening |
| Largest file to open (MB) | 10 | |
| Suggested file name | my-map | `.amap` is added |

## Browsers and privacy

- Chrome, Edge and managed Chromebooks use the File System Access API, so **Save** overwrites the same file.
- Safari, Firefox and cross-origin iframes download the file instead (each Save is a new download), and open it with a normal file chooser.
- Map content created by the user (added data, drawings) goes only to the user's device.
  Basemap tiles and public layers are still requested from their services, as in any web map.

## Code layout

- `src/runtime/lib/amap-format.ts`: file naming, validation, hardening, drawings→feature collection (pure, unit-tested)
- `src/runtime/lib/serialize.ts`: live map → web map JSON, using only public SDK `toJSON()` methods (SDK 5 `WebMap` has no public `toJSON()`)
- `src/runtime/lib/apply.ts`: file → live map merge, using public `WebMap.fromJSON()`
- `src/runtime/lib/file-io.ts`: open/save with the File System Access API and fallbacks
- `src/runtime/lib/version.ts`: widget and file-format version numbers (shown in the widget footer)

## Testing done (outside Experience Builder)

- 16 Jest unit tests (`tests/`): format helpers, hardening, save→open round trip with fake map objects.
- Type-check of all source and tests with stand-ins for the `jimu-*` modules.
- Real ArcGIS Maps SDK 5.1 round trip in headless Chromium: CSV-style client data, a service layer
  with a filter, a tile layer, mixed drawings with text, basemap and viewpoint. All were saved, read back by
  `WebMap.fromJSON()`, merged into a second map, and saved again without warnings.

**Not yet tested:** inside Experience Builder itself (JimuMapView, the Add Data and Draw widgets,
layer data sources, the settings panel). That needs a run in Developer Edition.

## Versions

| Item | Version | Bump when |
|---|---|---|
| Widget | 1.0.0 | Every release (`manifest.json` + `version.ts`) |
| File format | 1.0 | Serialisation or open/merge rules change (`version.ts`) |
