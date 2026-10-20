# Take My Work

A single web page that lets a student save a copy of their ArcGIS Online work to their own device before their school account closes. It runs entirely in the browser, uses none of the school's ArcGIS credits, and changes nothing in the account.

Version **1.0.0**. Created by Jason Sawle. Lab app: try it here before it goes anywhere else.

## How it works

1. **Sign in** with the school account (the school's own sign-in page, including single sign-on).
2. **Choose your work.** Every item the student owns is listed and ticked, with what they'll get for each.
3. **Save to your device.** The page builds one `.zip` file and saves it.

## What's in the .zip

| Folder or file | What it is |
|---|---|
| `index.html` | A portfolio page listing everything, with links. Open it after unzipping |
| `maps/*.mmap` | Each web map as a self-contained ArcGIS web map. Layers from the student's own hosted layers are replaced by the data itself, with the map's styles, filters and pop-ups, so the map no longer depends on the account. Other layers (Living Atlas and so on) stay as links. They open in [Atlas](../atlas/) with no account |
| `stories/*.html` | Reading copies of StoryMaps: text, headings, lists, pictures, captions and links to the saved maps |
| `items/<title>-<id>/` | A full copy of each item: `item.json`, its data (`data.json`, the file itself, or `notebook.ipynb`), thumbnail, metadata and resources (StoryMap images, app configuration) |
| `items/…/layers/` | Hosted layer data: each layer and table as GeoJSON, CSV (UTF-8, opens in Excel; points get longitude and latitude) and ArcGIS JSON, the service definition, and attachments with an `index.csv` |
| `portfolio/viewer.html` | An interactive map viewer for the `.mmap` files, once the folder is on a website (for example GitHub Pages) |
| `manifest.json` | Everything that was saved and how items depend on each other, for a future Restore tool |
| `README.txt` | What's inside, what to do next, and anything to check |

Items that chosen items use (a story's maps, a map's layers) are added automatically when the student owns them.

## What it can't save

Items other people own; subscriber, premium or licensed content (maps keep links to it); the data in tile, vector tile, imagery and scene layers (settings and links are saved); single files over 500 MB. Apps and dashboards are saved as settings and pictures: they can be rebuilt but can't run outside ArcGIS.

## Cost and privacy

- **No credits.** The page only reads: item details and data, resources, thumbnails, and feature queries. It never runs Export Data (which creates a stored file), analysis or geocoding, and creates nothing in ArcGIS Online.
- **Nothing leaves the browser** except requests to the school's ArcGIS organization. The copy is built in the tab and saved to the device.
- The sign-in token is kept in memory for the tab only. The page loads JSZip from cdnjs.cloudflare.com.
- The portfolio warns students that the copy includes private items and their data before they put it online.

## Set up for a school (once)

1. In ArcGIS Online, go to **Content → New item → Application → Other application** and give it a title.
2. Under **Redirect URIs**, add this page's address both ways, for example `https://jsawle.github.io/localmapsave/takeaway/` and `https://jsawle.github.io/localmapsave/takeaway/index.html`.
3. Open the page with no settings, choose **I'm setting this up for my school**, and enter the organization's address and the **Client ID**. It makes the link to give students:
   `…/takeaway/?portal=https://yourschool.maps.arcgis.com&clientId=<client id>`

Use the organization's own address (not www.arcgis.com) when students sign in with single sign-on. Put the registration under an account that will last. A school can also host its own copy: the page is one file.

## Limits

| Limit | Value |
|---|---|
| One file or resource | 500 MB |
| All attachments together | 1 GB |
| Whole copy | about 1.9 GB (a warning from 1.2 GB); bigger means saving in two or more parts |
| Features per layer | 250,000 |
| Atlas opens | 5,000 features per map file (all the data is still in the layer files) |

## Versions

Shown in the app's *About* panel and stamped in `manifest.json` and the portfolio.

| Part | Version |
|---|---|
| Take My Work (app) | 1.0.0 |
| Sign-in | 1.0.0 |
| Finding your items | 1.0.0 |
| Item copies | 1.0.0 |
| Layer data | 1.0.0 |
| Maps you can reopen | 1.0.0 |
| StoryMap reading copies | 1.0.0 |
| Portfolio page | 1.0.0 |

## Accessibility

WCAG 2.1 AA / Section 508: keyboard throughout, labelled controls and table, progress read out by screen readers, focus moved to each new step, light and dark themes, no sideways scrolling on phones. The app and the generated portfolio and story pages pass an axe-core scan in the tests.

## Tests

`python3 takeaway/tests/e2e.py --deps DIR` runs the whole flow in headless Chromium against a mock ArcGIS Online: PKCE sign-in, paged content and folders, throttling (429) and an expiring token, hosted layers with record limits, attachments both ways, then unpacks the `.zip` and checks every part, opens the map files with Atlas's own reader (`tests/check-mmap.mjs`), scans pages with axe-core, and checks the request log for anything that would use credits. `DIR` holds `npm pack jszip@3.10.1 axe-core@4` unpacked.

The mock is built from Esri's documentation, so the first run against a real organization is the real test.
