# Atlas: Sketch lab

A lab copy of the white-label Atlas app (`../atlas/`) for demos. It's the same app, version **1.15.0-sketch.9**, but Sketch uses the SDK's Sketch component, which is Map Viewer's drawing toolbar, instead of the app's own tool buttons. The full description, versions table and known limits are in the `sketch-mapviewer` branch's `atlas/README.md` (pull request #27).

| Link | What you get |
|---|---|
| `https://jsawle.github.io/localmapsave/atlas-sketch/` | Neutral "School Atlas" branding |
| `…/atlas-sketch/?config=mapmaker` | MapMaker's groups, units, colours and wording |
| `…/atlas-sketch/?config=example-es` | Spanish-language version |

Apart from Sketch, the two apps are the same: CSV 3.4, the Coordinates fixes, and saving (1.14.5 / 1.15.0-sketch.6). **Lab only for now (1.15.0-sketch.7): locked maps.** *Save a locked copy* writes a map that Save in this app never changes (a teacher's class map, a student's hand-in); the mark is inside the file. Opening one is just looking; Save makes your own copy. Any other map file saves back to itself on any device. 1.15.0-sketch.8 rewords the message after saving a locked copy: it used to say nobody could save over it, but Save as can still replace a locked map that wasn't opened in that session. Two people saving the same unlocked map on a shared drive: whoever saves last wins, with no warning. 1.15.0-sketch.9: picking a file in the save box that Chrome can't write (someone else's, or read-only) used to do nothing at all, because Chrome reports it the same way as Cancel. The app now says nothing was saved and to choose another name or folder. Found by the simulated Chromebook test (`../atlas/tests/chromebook-sim/`). The main app gets this in its own pull request once it's been tried here.

The working app stays at `https://jsawle.github.io/localmapsave/atlas/` (1.14.5), so the two can be shown side by side.

- **Saved maps** use the same `.amap` format, so a file saved in either app opens in the other. Both apps are on the same site, so *My map files* lists the same maps in both.
- **Sign-in** needs `https://jsawle.github.io/localmapsave/atlas-sketch/oauth-callback.html` added as a redirect URI on the app's client ID in ArcGIS Online. Until then, use sign-in in the main app.
- **Tests** live with the main app in `../atlas/tests/` (on the `sketch-mapviewer` branch for this version). This folder holds only what the page loads.
- **When Sketch moves into the main app**, delete this folder.
