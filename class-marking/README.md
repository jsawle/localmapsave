# Class marking (MapMaker Labs): test assignments

Groundwork for a MapMaker Labs app that helps a teacher review a class's hand-in folder of `.amap` files. It's not part of Atlas: nothing here is loaded by `atlas/` or `atlas-sketch/`.

What's here so far:

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
| `tools/test.mjs` | 41 tests: the checks against the test classes, and that Atlas still writes map file format 2.2 |
| `tools/base-*.amap`, `tools/trails-west.json` | The starting maps (saved from the lab app with the real MapMaker layers) and the Oregon and California Trail lines |

```
node class-marking/tools/make.mjs    # rebuild the assignments and test classes
node class-marking/tools/test.mjs    # run the tests
```

## Sources

- Volcano facts: MapMaker's **Volcanoes Around the World** layer (Smithsonian Institution Global Volcanism Program, 2024), read from its feature service.
- Oregon Trail route and landmarks: MapMaker's **Trails West** layer (US National Park Service, 2023). Every landmark is within 3 km of its Oregon Trail line; the California Trail positions used for one hand-in are within 7 km of the California Trail line.

## Known limits

- **The checks are first-pass.** Answers are matched by keywords in English and Spanish (such as *subduction*, *rift*, *punto caliente*) and names allow small misspellings. Anything else is left for the teacher. The quality of the writing isn't judged.
- **Misspelt names that sound right** but are spelled very differently (*Ayafyala* for Eyjafjallajökull) aren't recognised. The point still counts, because places are matched by location first.
- **Facts in a written note** are found by place name only: the checks don't yet say whether the setting or year given in the note is right.
- **The answer route** joins the trail layer's pieces. One 169 km gap in the layer's line in Idaho is bridged with a straight line.
- **The personas describe needs, not abilities.** Several hand-ins show where the task itself got in the way: placing points without sight or a mouse, or losing the wider view when zoomed in. That is what the written option, and the checks for answers in a note, are there for. The hand-ins aren't a prediction of how students with those needs do.
