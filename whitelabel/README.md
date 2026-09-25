# Map Studio (white-label school mapping app)

A configurable school mapping app built on ArcGIS Maps SDK for JavaScript 5.1. Status: **prototype v0.1**.

- **Layers:** the same public Schools Living Atlas group as National Geographic MapMaker, browsable by topic.
- **2D and 3D:** one map, switchable between a 2D map and a 3D scene.
- **Your own data:** drag and drop a CSV with latitude and longitude, and colour it by any column.
- **Local save:** save and open `.mmap` files on your own computer, with no ArcGIS account. It also opens files from the Atlas local-save concept.
- **Tools:** basemaps, layer list, legend, search, measure and sketch.
- **3D animations** as plug-ins. The first is the Vesuvius 1944 eruption.

## Try it

- Default: `…/whitelabel/index.html`
- Example country setup (Spanish, Panama start view): `…/whitelabel/index.html?config=example-country`

## Set up a version for your country

Copy `config/default.json` to `config/<your-name>.json`, edit it, and open the app with `?config=<your-name>`.

| Setting | What it does |
|---|---|
| `appName`, `tagline`, `logo` | Name and logo in the header (`logo.url` can be a file next to the app) |
| `theme` | Colours: `brand` (buttons), `header`, `accent` |
| `locale`, `dir` | Language code for the ArcGIS tools (e.g. `es`, `ar`) and text direction (`rtl` for Arabic) |
| `strings` | Your translations of the app's own words (see `config/example-country.json` for the list) |
| `contentGroup` | ArcGIS Online group whose layers students can add. Default: Schools Living Atlas |
| `basemapGroup`, `defaultBasemap` | Basemap group and the starting basemap (a web map item ID) |
| `startView` | Where the map opens: `center` [longitude, latitude] and `zoom` |
| `units` | `metric` or `imperial` for measuring |
| `features` | Turn tools on or off: `addLayers`, `sketch`, `measure`, `csv`, `localSave`, `threeD`, `animations` |
| `animations` | Which animations to offer, by folder name in `animations/` |

Groups must be **public**, as the app doesn't sign anyone in.

## Add an animation

Create `animations/<id>/animation.js` exporting:

```js
export const meta = { id, title, summary, version, models: [[name, version, description], …] };
export async function start({ view, map, container, toast }) {
  // view: the 3D SceneView. container: the panel to build your controls in.
  // Add layers, a RenderNode, sound… then:
  return { dispose() { /* remove everything you added */ } };
}
```

Then add `<id>` to `animations` in the config. Each animation's model versions appear in the app's About → Versions table.

## Privacy

- Nothing a student adds, draws or saves leaves their device.
- CSV files are read in the browser.
- Saved maps are files on their computer.
- The app only reads public ArcGIS Online content.

## Known limits (prototype)

- **Animations are experimental:** they use Esri's RenderNode API, which Esri marks as experimental and doesn't support. It may change between SDK versions, so retest after any SDK upgrade.
- **The 3D view needs WebGL2:** very old school devices may not show 3D or the animations.
- **Share by file only:** there's no share link or print yet. Share a map by sending the `.mmap` file.
