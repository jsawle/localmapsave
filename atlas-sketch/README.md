# Atlas: Sketch lab

A lab copy of the white-label Atlas app (`../atlas/`) for demos. It's the same app, version **1.15.0-sketch.4**, but Sketch uses the SDK's Sketch component, which is Map Viewer's drawing toolbar, instead of the app's own tool buttons. The full description, versions table and known limits are in the `sketch-mapviewer` branch's `atlas/README.md` (pull request #27).

| Link | What you get |
|---|---|
| `https://jsawle.github.io/localmapsave/atlas-sketch/` | Neutral "School Atlas" branding |
| `…/atlas-sketch/?config=mapmaker` | MapMaker's groups, units, colours and wording |
| `…/atlas-sketch/?config=example-es` | Spanish-language version |

Apart from Sketch, the two apps are the same: both have CSV 3.4 (locations from one column pasted from the Coordinates tool) and the Coordinates fixes (coordinates stay where the map was clicked, a **Copy coordinates** button, the tool fits the Measure panel). The lab copy's Sketch also has a **Go to the drawing tools** button for keyboard users (Sketch 2.2).

The working app stays at `https://jsawle.github.io/localmapsave/atlas/` (1.14.3), so the two can be shown side by side.

- **Saved maps** use the same `.amap` format, so a file saved in either app opens in the other. Both apps are on the same site, so *My map files* lists the same maps in both.
- **Sign-in** needs `https://jsawle.github.io/localmapsave/atlas-sketch/oauth-callback.html` added as a redirect URI on the app's client ID in ArcGIS Online. Until then, use sign-in in the main app.
- **Tests** live with the main app in `../atlas/tests/` (on the `sketch-mapviewer` branch for this version). This folder holds only what the page loads.
- **When Sketch moves into the main app**, delete this folder.
