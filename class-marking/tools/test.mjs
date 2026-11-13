// Tests for the class-marking checks against the test classes. Run: node class-marking/tools/test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WEBMAP_WRITER_VERSION } from "../../atlas-sketch/lib/doc.js";
import { readHandIn, assess, mentions } from "./checks.mjs";
import { namesFor, keyFromAnswerMap, studentFromFile, classCsv } from "./keys.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = path.join(HERE, "..", "assignments");
let fails = 0, n = 0;
const ok = (cond, name, detail) => { n++; if (!cond) { fails++; console.log("FAIL " + name, detail === undefined ? "" : JSON.stringify(detail)); } };

// The checks read the map file format Atlas writes now. If Atlas changes it, check the reader before changing this.
ok(WEBMAP_WRITER_VERSION === "3.5", "Atlas still writes map file format 3.5 (3.1 to 3.3 add sketch styles, 3.4 notes a 3D view and columns in 3D, 3.5 the sketch layer's transparency; the checks read the layers and each sketch's kind, title, description and colour, which did not change)", WEBMAP_WRITER_VERSION);

const T = JSON.parse(fs.readFileSync(path.join(HERE, "trails-west.json"), "utf8")).trails;
function load(assignment) {
  const key = JSON.parse(fs.readFileSync(path.join(A, assignment, "key.json"), "utf8"));
  if (key.route) key.route.paths = T.Oregon;
  const exp = JSON.parse(fs.readFileSync(path.join(A, assignment, "expected.json"), "utf8"));
  const got = {};
  for (const r of exp.results) {
    const file = path.join(A, assignment, "class", r.file);
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { got[r.file] = null; continue; }
    got[r.file] = assess(readHandIn(raw), key);
    ok(JSON.stringify(got[r.file]) === JSON.stringify(r.checks), `${assignment}: ${r.file} matches expected.json`);
  }
  return got;
}
const place = (res, name) => res.places.find((p) => p.name.startsWith(name));

const v = load("volcanoes");
ok(v["Volcanoes - Sam_locked.amap"] === null, "a damaged file is reported as unreadable, not checked");
ok(v["notes.txt"] === null, "a stray text file isn't checked");
ok(place(v["Volcanoes - Jordan_locked.amap"], "Mount Pinatubo").facts.year === false, "Jordan: 1991 for Pinatubo flagged as not the last known eruption");
ok(place(v["Volcanoes - Sofia_locked.amap"], "Eyjafjallajökull").facts.setting === true, "Sofía: a Spanish answer (zona de rift) is recognised");
ok(place(v["Volcanoes - Sofia_locked.amap"], "Kīlauea").facts.setting === true, "Sofía: punto caliente is recognised");
ok(place(v["Volcanoes - Eli_locked.amap"], "Eyjafjallajökull").facts.setting === false, "Eli: subduction for Eyjafjallajökull is flagged");
ok(v["Volcanoes - Tariq_locked.amap"].places.every((p) => !p.found && p.inNote), "Tariq: every volcano found in his written note");
ok(place(v["Volcanoes - Mina_locked.amap"], "Mount Fuji").namedButFarKm === 100, "Mina: Mount Fuji named but placed about 100 km away", place(v["Volcanoes - Mina_locked.amap"], "Mount Fuji"));
ok(v["Volcanoes - Devon_locked.amap"].placesFound === 3 && place(v["Volcanoes - Devon_locked.amap"], "Mount Pinatubo").inNote, "Devon: three placed, the rest in his note");
ok(v["Volcanoes - Caleb_locked.amap"].places.filter((p) => p.named).length === 4, "Caleb: four misspelt names still recognised (Ayafyala isn't)", v["Volcanoes - Caleb_locked.amap"].places.map((p) => p.named));
ok(!v["Volcanoes - Kayla.amap"].locked && v["Volcanoes - Kayla.amap"].emptyPopups === 1 && !place(v["Volcanoes - Kayla.amap"], "Kīlauea").found, "Kayla: not locked, one empty pop-up, Kīlauea missing");
ok(v["Volcanoes - Alex_locked.amap"].placesFound === 0 && v["Volcanoes - Alex_locked.amap"].missingLayers.length === 0, "Alex: blank map with both layers");

const o = load("oregon-trail");
ok(o["Oregon Trail - Eli_locked.amap"].route.shareOnRoute === 1 && o["Oregon Trail - Eli_locked.amap"].route.reachesCheckpoint === "Oregon City", "Eli: whole line on the trail, reaching Oregon City");
ok(o["Oregon Trail - Mina_locked.amap"].route.reachesCheckpoint === "Fort Hall" && o["Oregon Trail - Mina_locked.amap"].route.shareOnRoute < 0.8, "Mina: line leaves the Oregon Trail after Fort Hall");
ok(o["Oregon Trail - Kayla_locked.amap"].route.reachesCheckpoint === "Independence Rock", "Kayla: line stops at Independence Rock");
ok(o["Oregon Trail - Tariq_locked.amap"].route.drawn === false && o["Oregon Trail - Tariq_locked.amap"].places.every((p) => p.inNote), "Tariq: no line, every place in his note");
ok(!place(o["Oregon Trail - Jordan_locked.amap"], "South Pass").found, "Jordan: South Pass missing");
ok(o["Oregon Trail - Devon_locked.amap"].route.shareOnRoute < 0.9 && o["Oregon Trail - Devon_locked.amap"].placesFound === 5, "Devon: straight-line route drifts, all places found");
ok(o["Oregon Trail - Caleb_locked.amap"].places.every((p) => p.named), "Caleb: Independance, Chimny, Soth Pass, Oregon Citty recognised");

// name matching
ok(mentions("Mt Fugi", ["fuji"]) && mentions("Kilawea", ["kilauea"]) && !mentions("Kilimanjaro", ["kilauea"]), "misspellings match, other names don't");
ok(!mentions("Independence, Missouri", ["independence rock"]), "Independence, Missouri isn't Independence Rock");

// answer map -> key, file names, export
ok(JSON.stringify(namesFor("Mount Fuji (Fujisan)")) === JSON.stringify(["mount fuji (fujisan)", "mount fuji", "fujisan", "fuji"]), "names from a title", namesFor("Mount Fuji (Fujisan)"));
ok(namesFor("Independence, Missouri").includes("independence"), "a title before its comma is a name too");
const sf = (n) => JSON.stringify(studentFromFile(n));
ok(sf("Volcanoes - Jordan (2)_locked.amap") === JSON.stringify({ student: "Jordan", copy: 2 }) && sf("Oregon Trail - Sofia_locked.amap") === JSON.stringify({ student: "Sofia", copy: 1 }) && studentFromFile("mymap.amap").student === "mymap", "student names from file names");
const vAns = JSON.parse(fs.readFileSync(path.join(A, "volcanoes", "Volcanoes - answer key_locked.amap"), "utf8"));
const vk = keyFromAnswerMap(vAns, { skip: [5] });
ok(vk.places.length === 5 && !vk.route && vk.answerNotes.length === 1 && vk.layers.length === 2, "volcano answer map: 5 places, the pattern note set aside, 2 layers", { p: vk.places.length, n: vk.answerNotes.length });
const vGen = assess(readHandIn(JSON.parse(fs.readFileSync(path.join(A, "volcanoes", "class", "Volcanoes - Mina_locked.amap"), "utf8"))), vk);
ok(vGen.placesFound === 4 && vGen.places.find((p) => p.name.startsWith("Mount Fuji")).namedButFarKm === 100, "a key made from the answer map finds the same for Mina");
const oAns = JSON.parse(fs.readFileSync(path.join(A, "oregon-trail", "Oregon Trail - answer key_locked.amap"), "utf8"));
const ok2 = keyFromAnswerMap(oAns, { skip: [5] });
ok(ok2.route && ok2.route.checkpoints.map((c) => c.name).join(" > ") === "Independence, Missouri > Chimney Rock > Independence Rock > South Pass > Oregon City", "Oregon answer map: route with its places in order", ok2.route && ok2.route.checkpoints.map((c) => c.name));
const oMina = assess(readHandIn(JSON.parse(fs.readFileSync(path.join(A, "oregon-trail", "class", "Oregon Trail - Mina_locked.amap"), "utf8"))), ok2);
ok(oMina.route.reachesCheckpoint === "South Pass" && oMina.route.shareOnRoute < 0.8, "with the answer map's own route, Mina's line gets as far as South Pass", oMina.route);
const csv = classCsv([{ student: "=HYPERLINK(1)", file: "a.amap", result: vGen, mark: "15", comment: 'said "hi", then' }, { student: "Sam", file: "b.amap", result: null }], vk, {});
ok(csv.includes("'=HYPERLINK(1)") && csv.includes('"said ""hi"", then"') && csv.includes("Couldn't read this file"), "export: formulas made harmless, quotes and commas kept, unreadable files listed");
const anon = classCsv([{ student: "Mina", file: "Volcanoes - Mina_locked.amap", result: vGen }], vk, { anonymous: true });
ok(!anon.includes("Mina") && anon.includes("Student 1") && !anon.includes("_locked"), "numbered export has no names or file names");

const twice = classCsv([{ student: "Jordan", copy: 2, file: "a", result: vGen }, { student: "Jordan", copy: 1, file: "b", result: vGen }, { student: "Mina", copy: 1, file: "c", result: vGen }], vk, { anonymous: true }).split("\r\n");
ok(twice[1].startsWith("Student 1 (copy 2),2,") && twice[2].startsWith("Student 1,2,") && twice[3].startsWith("Student 2,1,"), "numbered export: a student's two hand-ins share a number, and the count shows", twice.slice(1, 4).map((l) => l.slice(0, 22)));

console.log(fails ? `${fails} of ${n} checks failed` : `All ${n} checks passed.`);
process.exit(fails ? 1 : 0);
