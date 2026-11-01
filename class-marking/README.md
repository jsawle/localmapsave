# Class map review (MapMaker Labs)

A MapMaker Labs app that helps a teacher review a class's hand-in folder of `.amap` files. It's not part of Atlas: nothing here is loaded by `atlas/` or `atlas-sketch/`.

**Try it:** `https://jsawle.github.io/localmapsave/class-marking/`. Pick a sample class, or your own hand-in folder and answer map.

## The app (0.1.0)

1. **Choose the hand-ins:** a folder, or some files. Other files in the folder are skipped and counted. A file with "answer" in its name is taken as the answer map.
2. **Choose your answer map:** any map saved from MapMaker, with a point on each right place and, if there is one, a line for the route. Points that look like notes ("Pattern", "Why…?") are left out; tick them to count them. Set how close counts (50 km by default).
3. **The class table:** one row per hand-in, with places found, places only named in a note or put too far away, how much of a route follows yours and how far it gets, empty pop-ups, missing layers, unlocked hand-ins, students with more than one hand-in, and files that can't be read.
4. **Each student:** their sketches on the map with your answer drawn over them (purple rings, tolerance circles, route), and beside it, in words, every place with what they wrote and whether it matches the key. **Previous** and **Next** step through the class; Escape goes back to the table.
5. **Your mark and comment** for each student are kept in this browser on this device, and go into the export.
6. **Export spreadsheet (CSV):** every result, the students' own words for each place, and your marks and comments. Tick **Numbers instead of names** to leave out names and file names (students' own words may still contain names).

Privacy and safety: files are read in the browser and nothing is uploaded. A student's own layers are listed, never loaded, and only their sketches are drawn, by the app. The basemap and layers come from your answer map, read the way Atlas reads an opened file. Exported cells that start like a formula are made into plain text.

The two sample classes come with richer keys than an answer map gives: accepted answers for each fact (tectonic setting, eruption year), in English and Spanish.

## Test assignments and checks

- **Two assignments**, each with student steps, an answer key from MapMaker's own layers, and a suggested rubric:
  - [Volcanoes and plate boundaries](assignments/volcanoes/assignment.md): grades 7–8 Earth science, points and pop-ups.
  - [The Oregon Trail](assignments/oregon-trail/assignment.md): grade 8 US history, a route line, points and pop-ups.
- **A test class for each**: one locked hand-in per student persona from `jsawle/lessons` (`review/personas.md`), plus awkward files (a second hand-in, a blank map, a damaged file, an unlocked file, a stray text file). They're made-up test data, built with Atlas's own file writer, and each opens in the lab app.
- **The checks** (`tools/checks.mjs`, version 0.1): which places a student marked within the tolerance, what they wrote there, whether a written note names places they couldn't mark, how much of a route line follows the real trail and how far it gets, empty pop-ups, missing layers and whether the hand-in is locked. The checks report facts for the teacher. They don't give a mark.

| File | What it is |
|---|---|
| `assignments/<name>/assignment.md` | Student steps, answer key, rubric, and what each test hand-in shows |
| `assignments/<name>/<Name> - answer key_locked.amap` | The teacher's answer map |
| `assignments/<name>/class/` | The test class's hand-in folder |
| `assignments/<name>/key.json` | The key the checks use: places, tolerances, accepted answers, route |
| `assignments/<name>/expected.json` | What the checks find in each hand-in, with the intended story for each persona |
| `tools/make.mjs` | Builds everything above (the same files every run) |
| `tools/checks.mjs`, `tools/geo.mjs` | The checks: plain JavaScript, for Node now and the browser later |
| `tools/keys.mjs` | A key from an answer map, student names from file names, and the export |
| `index.html`, `app.js` | The app |
| `tools/test.mjs` | 50 tests: the checks against the test classes, keys from the answer maps, the export, and that Atlas still writes map file format 2.2 |
| `tools/base-*.amap`, `tools/trails-west.json` | The starting maps (saved from the lab app with the real MapMaker layers) and the Oregon and California Trail lines |

```
node class-marking/tools/make.mjs    # rebuild the assignments and test classes
node class-marking/tools/test.mjs    # run the tests
python3 -m http.server 8765          # from the repo root, then open http://localhost:8765/class-marking/
```

## Sources

- Volcano facts: MapMaker's **Volcanoes Around the World** layer (Smithsonian Institution Global Volcanism Program, 2024), read from its feature service.
- Oregon Trail route and landmarks: MapMaker's **Trails West** layer (US National Park Service, 2023). Every landmark is within 3 km of its Oregon Trail line; the California Trail positions used for one hand-in are within 7 km of the California Trail line.

## Known limits

- **Keys from an answer map check places and routes only.** Accepted answers (a fact, a year) need a key file, as the samples have. Writing quality isn't judged: that's for the teacher, or an AI add-on reading the export.
- **Marks are kept in one browser on one device.** Clearing the browser's data removes them; export to keep them.
- **Tested in Chrome** (desktop size and narrow), with the keyboard alone and an automated accessibility check (axe: no problems outside the map). Not yet tried on a real Chromebook, in Safari or Firefox, or with a screen reader.

- **The checks are first-pass.** Answers are matched by keywords in English and Spanish (such as *subduction*, *rift*, *punto caliente*) and names allow small misspellings. Anything else is left for the teacher. The quality of the writing isn't judged.
- **Misspelt names that sound right** but are spelled very differently (*Ayafyala* for Eyjafjallajökull) aren't recognised. The point still counts, because places are matched by location first.
- **Facts in a written note** are found by place name only: the checks don't yet say whether the setting or year given in the note is right.
- **The answer route** joins the trail layer's pieces. One 169 km gap in the layer's line in Idaho is bridged with a straight line.
- **The personas describe needs, not abilities.** Several hand-ins show where the task itself got in the way: placing points without sight or a mouse, or losing the wider view when zoomed in. That is what the written option, and the checks for answers in a note, are there for. The hand-ins aren't a prediction of how students with those needs do.
