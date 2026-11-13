// Builds the two test assignments: the teacher's answer map, a class of hand-ins written as the student
// personas in jsawle/lessons review/personas.md, a few awkward files, the key and the expected results.
// Every hand-in is a real .amap, built with Atlas's own writer (a copy of Atlas 5.0's lib/doc.js, in ../lib/doc.js).
// Run: node class-marking/tools/make.mjs   (repeatable: the same files every time)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sketchToOperationalLayers, cleanSketchAttributes, lonLatToXY, LOCK_PROP } from "../lib/doc.js";
import { chainRoute, simplify, seeded, jitter, km } from "./geo.mjs";
import { readHandIn, assess, CHECKS_VERSION } from "./checks.mjs";

export const MAKE_VERSION = "0.1";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "assignments");
const SR = { wkid: 102100, latestWkid: 3857 };
const APP_VERSION = "1.15.0-sketch.9";

let uidN = 0;
const uid = () => "t" + String(++uidN).padStart(6, "0");
const pt = (lonlat, title, description, color = "#0079c1", size = 12) => {
  const [x, y] = lonLatToXY(lonlat[0], lonlat[1]);
  const geometry = { x, y, spatialReference: SR };
  return { geometry, attributes: cleanSketchAttributes({ uid: uid(), kind: "point", title, description, color, size }, geometry) };
};
const line = (lonlats, title = "", description = "", color = "#d83020", size = 12) => {
  const geometry = { paths: [lonlats.map(([lo, la]) => lonLatToXY(lo, la))], spatialReference: SR };
  return { geometry, attributes: cleanSketchAttributes({ uid: uid(), kind: "polyline", title, description, color, size }, geometry) };
};
const extent = ([xmin, ymin, xmax, ymax]) => {
  const [x0, y0] = lonLatToXY(xmin, ymin), [x1, y1] = lonLatToXY(xmax, ymax);
  return { viewpoint: { targetGeometry: { xmin: x0, ymin: y0, xmax: x1, ymax: y1, spatialReference: SR } } };
};
function amap(base, graphics, { locked = true, view } = {}) {
  const wm = JSON.parse(JSON.stringify(base));
  wm.operationalLayers = wm.operationalLayers.concat(sketchToOperationalLayers(graphics, "My sketches", true));
  wm.authoringAppVersion = APP_VERSION;
  if (view) wm.initialState = extent(view);
  if (locked) wm[LOCK_PROP] = true;
  return wm;
}
const write = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof obj === "string" ? obj : JSON.stringify(obj)); };

// =============================================================================================== volcanoes
// Facts: MapMaker's "Volcanoes Around the World" layer (Smithsonian Global Volcanism Program, 2024).
const V = {
  helens: { name: "Mount St. Helens", names: ["st. helens", "st helens", "saint helens", "santa helena"], lonlat: [-122.18, 46.2], setting: "subduction", year: "2008" },
  fuji: { name: "Mount Fuji (Fujisan)", names: ["fuji", "fujisan"], lonlat: [138.728, 35.361], setting: "subduction", year: "1708" },
  pinatubo: { name: "Mount Pinatubo", names: ["pinatubo"], lonlat: [120.35, 15.13], setting: "subduction", year: "2021" },
  eyja: { name: "Eyjafjallajökull", names: ["eyjafjallajokull"], lonlat: [-19.633, 63.633], setting: "rift", year: "2010" },
  kilauea: { name: "Kīlauea", names: ["kilauea"], lonlat: [-155.287, 19.421], setting: "hotspot", year: "2024" }
};
const SETTING = {
  subduction: { right: ["subduc"], wrong: ["rift", "hot ?spot", "intraplate", "punto caliente", "divergent"] },
  rift: { right: ["rift", "divergent", "ridge", "dorsal", "separan", "pull(s|ing)? apart", "move apart"], wrong: ["subduc", "hot ?spot", "intraplate", "punto caliente"] },
  hotspot: { right: ["hot ?spot", "intraplate", "punto caliente", "middle of (the|a) plate", "en medio de la placa"], wrong: ["subduc", "rift", "divergent"] }
};
const YEAR_WRONG = { helens: ["1980"], fuji: [], pinatubo: ["1991"], eyja: [], kilauea: ["2018", "2023"] };
const volcanoKey = {
  id: "volcanoes", title: "Volcanoes and plate boundaries", grade: "7–8 Earth science",
  layers: ["Tectonic Plate Boundaries", "Volcanoes Around the World"],
  places: Object.entries(V).map(([id, v]) => ({ id, name: v.name, names: v.names, lonlat: v.lonlat, toleranceKm: 50,
    facts: [{ id: "setting", label: "Tectonic setting", ...SETTING[v.setting] },
            { id: "year", label: "Last known eruption", right: [v.year === "1708" ? "170[78]" : v.year], wrong: YEAR_WRONG[id] }] })),
  note: { label: "What pattern do you see?" }
};
const VKEY_TEXT = {
  helens: "Subduction zone. Last known eruption: 2008.",
  fuji: "Subduction zone. Last known eruption: 1708 (the eruption began in December 1707).",
  pinatubo: "Subduction zone. Last known eruption: 2021. The famous large eruption was in 1991.",
  eyja: "Rift zone, where plates pull apart (the Mid-Atlantic Ridge runs through Iceland). Last known eruption: 2010.",
  kilauea: "Intraplate: in the middle of the Pacific Plate, over a hotspot. Last known eruption: 2024."
};
const PATTERN_KEY = "Four of the five are on plate boundaries. Three are subduction zones around the edge of the Pacific Ocean (the Ring of Fire). Eyjafjallajökull is on a rift, where plates pull apart. Kīlauea is not on a boundary: it is in the middle of the Pacific Plate, over a hotspot.";

function volcanoes(base) {
  const dir = path.join(OUT, "volcanoes"), cls = path.join(dir, "class");
  const WORLD = [-170, -45, 170, 72];
  const rnd = seeded(7);
  const at = (id, maxKm = 12) => jitter(V[id].lonlat, maxKm, rnd);
  const NOTE_AT = [-150, 30];   // where a note point sits: the open Pacific
  // teacher's answer map
  const key = Object.keys(V).map((id) => pt(V[id].lonlat, V[id].name, VKEY_TEXT[id], "#7a3e9d"));
  key.push(pt(NOTE_AT, "What pattern do you see?", PATTERN_KEY, "#333333"));
  write(path.join(dir, "Volcanoes - answer key_locked.amap"), amap(base, key, { view: WORLD }));

  const students = [
    { file: "Volcanoes - Jordan_locked.amap", persona: "S1 Jordan (reads below grade level)",
      intent: "All five in the right places. Very short pop-ups. Gives 1991 for Pinatubo (the famous eruption, not the last known one). One-line pattern note.",
      g: [pt(at("helens", 20), "Mount St. Helens", "subduction zone. 2008"), pt(at("fuji", 20), "Mount Fuji", "subduction. last 1708"),
          pt(at("pinatubo", 20), "Pinatubo", "subduction 1991"), pt(at("eyja", 20), "Eyjafjallajokull", "rift 2010"),
          pt(at("kilauea", 20), "Kilauea", "hot spot 2024"), pt(jitter(NOTE_AT, 300, rnd), "Pattern", "most are on the lines")] },
    { file: "Volcanoes - Sofia_locked.amap", persona: "S2 Sofía (English learner, Spanish speaker)",
      intent: "Complete and correct, written in Spanish. Gives both 2021 and 1991 for Pinatubo. Full pattern note in Spanish.",
      g: [pt(at("helens"), "Monte Santa Helena", "Zona de subducción. Última erupción: 2008."),
          pt(at("fuji"), "Monte Fuji", "Zona de subducción. Última erupción: 1708."),
          pt(at("pinatubo"), "Monte Pinatubo", "Zona de subducción. Última erupción: 2021. La gran erupción fue en 1991."),
          pt(at("eyja"), "Eyjafjallajökull", "Zona de rift: las placas se separan. Última erupción: 2010."),
          pt(at("kilauea"), "Kīlauea", "Punto caliente, en medio de la placa del Pacífico. Última erupción: 2024."),
          pt(jitter(NOTE_AT, 300, rnd), "Patrón", "Casi todos están en los límites de las placas. Tres están alrededor del océano Pacífico, en el Anillo de Fuego. Kīlauea no está en un límite: está sobre un punto caliente.")] },
    { file: "Volcanoes - Eli_locked.amap", persona: "S3 Eli (red-green colour vision deficiency)",
      intent: "All five placed. Says Eyjafjallajökull is a subduction zone (wrong); colours his points red for subduction and green for the rest, and puts Eyjafjallajökull in red. Good pattern note otherwise.",
      g: [pt(at("helens"), "Mount St. Helens", "Subduction zone, last eruption 2008.", "#d7191c"), pt(at("fuji"), "Mount Fuji", "Subduction zone, last eruption 1708.", "#d7191c"),
          pt(at("pinatubo"), "Mount Pinatubo", "Subduction zone, last eruption 2021.", "#d7191c"), pt(at("eyja"), "Eyjafjallajökull", "Subduction zone, last eruption 2010.", "#d7191c"),
          pt(at("kilauea"), "Kīlauea", "Intraplate hotspot, last eruption 2024.", "#1a9641"),
          pt(jitter(NOTE_AT, 300, rnd), "Pattern", "The subduction volcanoes are around the edge of the Pacific Ocean. Kilauea is not on a plate boundary, it is in the middle of a plate.")] },
    { file: "Volcanoes - Tariq_locked.amap", persona: "S5 Tariq (blind, uses a screen reader)",
      intent: "No points on the volcanoes: he couldn't place them. All the answers, correct, are written in one note.",
      g: [pt(NOTE_AT, "My answers (written)", "I could not place points on the map, so here are my answers. Mount St. Helens: subduction zone, last eruption 2008. Mount Fuji (Fujisan): subduction zone, 1708. Pinatubo: subduction zone, 2021. Eyjafjallajökull: rift zone, 2010. Kīlauea: intraplate hotspot, 2024. Pattern: four are on plate boundaries, and three of those are subduction zones around the Pacific. Kīlauea is in the middle of a plate.")] },
    { file: "Volcanoes - Mina_locked.amap", persona: "S6 Mina (low vision, uses magnification)",
      intent: "Zoomed in, she put Mount Fuji on Tokyo, about 100 km away. The other four are right, with good pop-ups and a pattern note.",
      g: [pt(at("helens"), "Mount St. Helens", "It is in a subduction zone. The last known eruption was 2008."),
          pt([139.76, 35.68], "Mount Fuji", "It is in a subduction zone. The last known eruption was 1708."),
          pt(at("pinatubo"), "Mount Pinatubo", "It is in a subduction zone. The last known eruption was 2021."),
          pt(at("eyja"), "Eyjafjallajökull", "It is in a rift zone. The last known eruption was 2010."),
          pt(at("kilauea"), "Kīlauea", "It is intraplate, over a hotspot. The last known eruption was 2024."),
          pt(jitter(NOTE_AT, 300, rnd), "Pattern", "Most of the volcanoes are on plate boundaries around the Pacific. Kīlauea is away from the boundaries.")] },
    { file: "Volcanoes - Devon_locked.amap", persona: "S7 Devon (limited fine motor control, uses the keyboard)",
      intent: "Three points placed (St. Helens, Fuji, Kīlauea) with dictated full sentences. A note explains he couldn't place the other two with the keyboard and gives their answers in words.",
      g: [pt(at("helens"), "Mount St. Helens", "Mount St. Helens is in a subduction zone. Its last known eruption was in 2008."),
          pt(at("fuji"), "Mount Fuji", "Mount Fuji is in a subduction zone. Its last known eruption was in 1708."),
          pt(at("kilauea"), "Kīlauea", "Kīlauea is an intraplate volcano over a hotspot. Its last known eruption was in 2024."),
          pt(jitter(NOTE_AT, 300, rnd), "Note to my teacher", "I could not place the other two points with the keyboard. Pinatubo is a subduction zone volcano and its last eruption was 2021. Eyjafjallajökull is in a rift zone and its last eruption was 2010. Pattern: most are around the Pacific where plates sink.")] },
    { file: "Volcanoes - Caleb_locked.amap", persona: "S9 Caleb (dyslexia)",
      intent: "All five in the right places with the right answers, but names and some words misspelled (Fugi, Pinatoobo, Ayafyala, Kilawea).",
      g: [pt(at("helens"), "Mount St Helins", "subduction zone 2008"), pt(at("fuji"), "Mt Fugi", "subduction zone 1708"),
          pt(at("pinatubo"), "Pinatoobo", "subduction zone 2021"), pt(at("eyja"), "Ayafyala", "rift zone 2010"),
          pt(at("kilauea"), "Kilawea", "hot spot 2024"), pt(jitter(NOTE_AT, 300, rnd), "Pattern", "most are on plat boundrys around the pacific. kilawea is a hot spot in the midle")] },
    { file: "Volcanoes - Kayla.amap", persona: "S10 Kayla (attention)",
      intent: "First three done well. Eyjafjallajökull has a point but an empty pop-up; Kīlauea and the pattern note are missing. She forgot to lock her hand-in.",
      locked: false,
      g: [pt(at("helens"), "Mount St. Helens", "Subduction zone. Last eruption 2008."), pt(at("fuji"), "Mount Fuji", "Subduction zone. Last eruption 1708."),
          pt(at("pinatubo"), "Mount Pinatubo", "Subduction zone. Last eruption 2021."), pt(at("eyja"), "", "")] }
  ];
  const edge = [
    { file: "Volcanoes - Jordan (2)_locked.amap", persona: "S1 Jordan, second hand-in",
      intent: "Jordan handed in twice. The second file has a better pattern note; everything else is the same.",
      g: () => { const g = students[0].g.slice(0, 5); g.push(pt(jitter(NOTE_AT, 300, rnd), "Pattern", "Most volcanoes are on the plate lines around the Pacific. Kilauea is not on a line.")); return g; } },
    { file: "Volcanoes - Alex_locked.amap", persona: "Not a persona: a blank hand-in", intent: "Layers added, no sketches.", g: () => [] }
  ];
  const results = [];
  for (const s of students.concat(edge)) {
    const g = typeof s.g === "function" ? s.g() : s.g;
    const wm = amap(base, g, { locked: s.locked !== false, view: WORLD });
    write(path.join(cls, s.file), wm);
    results.push({ file: s.file, persona: s.persona, intent: s.intent, checks: assess(readHandIn(JSON.parse(JSON.stringify(wm))), volcanoKey) });
  }
  write(path.join(cls, "Volcanoes - Sam_locked.amap"), JSON.stringify(amap(base, students[2].g, { view: WORLD })).slice(0, 1500));   // cut short
  results.push({ file: "Volcanoes - Sam_locked.amap", persona: "Not a persona: a damaged file", intent: "Cut off part way through, so it isn't valid JSON. The marking app should list it as unreadable, not stop.", checks: null });
  write(path.join(cls, "notes.txt"), "Period 3 hand-ins. Remember: Devon and Tariq had the written option.\n");
  results.push({ file: "notes.txt", persona: "Not a hand-in", intent: "A stray file in the folder. The marking app should skip it.", checks: null });
  write(path.join(dir, "key.json"), JSON.stringify(volcanoKey, null, 1));
  write(path.join(dir, "expected.json"), JSON.stringify({ makeVersion: MAKE_VERSION, checksVersion: CHECKS_VERSION, assignment: "volcanoes", results }, null, 1));
  return results;
}

// =============================================================================================== Oregon Trail
// Route and landmark positions: the National Park Service "Trails West" layer in the MapMaker collection
// (every landmark below is within 3 km of its Oregon Trail line).
const T = JSON.parse(fs.readFileSync(path.join(HERE, "trails-west.json"), "utf8")).trails;
const O = {
  independence: { name: "Independence, Missouri", names: ["independence, missouri", "independence missouri", "independence, mo", "independence"], lonlat: [-94.4155, 39.0911] },
  chimney: { name: "Chimney Rock", names: ["chimney rock"], lonlat: [-103.3483, 41.7036] },
  irock: { name: "Independence Rock", names: ["independence rock"], lonlat: [-107.1314, 42.4939] },
  south: { name: "South Pass", names: ["south pass"], lonlat: [-108.92, 42.36] },
  oc: { name: "Oregon City", names: ["oregon city"], lonlat: [-122.6068, 45.3573] }
};
const FORT_HALL = [-112.43, 43.03], BOISE = [-116.2, 43.6], DALLES = [-121.18, 45.594], FORT_KEARNY = [-98.95, 40.64];
function oregonTrail(base) {
  const dir = path.join(OUT, "oregon-trail"), cls = path.join(dir, "class");
  const WEST = [-125, 36, -92, 49];
  const rnd = seeded(11);
  const chained = chainRoute(T.Oregon, O.independence.lonlat, O.oc.lonlat, 200);
  let cut = 0, bd = Infinity; chained.forEach((p, i) => { const d = km(p, O.oc.lonlat); if (d < bd) { bd = d; cut = i; } });
  const route = chained.slice(0, cut + 1);
  const at = (id, maxKm = 10) => jitter(O[id].lonlat, maxKm, rnd);
  const wobble = (pathLL, maxKm) => pathLL.map((p, i) => (i === 0 || i === pathLL.length - 1 ? p : jitter(p, maxKm, rnd)));
  const upTo = (pathLL, lonlat) => { let k = 0, d = Infinity; pathLL.forEach((p, i) => { const e = km(p, lonlat); if (e < d) { d = e; k = i; } }); return pathLL.slice(0, k + 1); };
  const NOTE_AT = [-100, 46];   // a note point: North Dakota, away from the trail
  const key = {
    id: "oregon-trail", title: "The Oregon Trail", grade: "8 US history",
    layers: ["Trails West"],
    places: Object.entries(O).map(([id, o]) => ({ id, name: o.name, names: o.names, lonlat: o.lonlat, toleranceKm: 40, facts: [] })),
    route: { name: "Oregon Trail", toleranceKm: 50, start: O.independence.lonlat, end: O.oc.lonlat, paths: T.Oregon,
      checkpoints: [{ name: "Chimney Rock", lonlat: O.chimney.lonlat }, { name: "Independence Rock", lonlat: O.irock.lonlat }, { name: "South Pass", lonlat: O.south.lonlat },
                    { name: "Fort Hall", lonlat: FORT_HALL }, { name: "The Dalles", lonlat: DALLES }, { name: "Oregon City", lonlat: O.oc.lonlat }] },
    note: { label: "Why did people go West? Use evidence from the Trails West layer." }
  };
  const KEY_TEXT = {
    independence: "Start of the trail. Wagon trains set off in April or May, when there was spring grass to feed the animals.",
    chimney: "A tall rock spire that travelers could see for days. It told them they were on the right route along the North Platte River.",
    irock: "Travelers hoped to reach it by July 4, so they could cross the mountains before the autumn snows. Many carved their names on it.",
    south: "A wide, gentle pass where wagons could cross the Rocky Mountains (the Continental Divide).",
    oc: "The end of the trail, in the Willamette Valley, where many families claimed farmland."
  };
  const REASON_KEY = "Many went for land and money. The Trails West layer says people were \"pursuing economic opportunities or cheap land recently taken from Native Americans\", and some went for the gold rush or the idea of Manifest Destiny.";
  const k = Object.keys(O).map((id) => pt(O[id].lonlat, O[id].name, KEY_TEXT[id], "#7a3e9d"));
  k.push(line(simplify(route, 3), "Oregon Trail", "Independence, Missouri to Oregon City", "#7a3e9d"));
  k.push(pt(NOTE_AT, "Why did people go West?", REASON_KEY, "#333333"));
  write(path.join(dir, "Oregon Trail - answer key_locked.amap"), amap(base, k, { view: WEST }));

  const cal = [[-113.3, 42.6], [-113.72, 42.08], [-114.9, 41.3], [-115.76, 40.83], [-117.0, 40.9], [-118.47, 40.18], [-119.3, 39.7], [-120.18, 39.33], [-121.0, 38.9], [-121.49, 38.58]];
  const students = [
    { file: "Oregon Trail - Jordan_locked.amap", persona: "S1 Jordan (reads below grade level)",
      intent: "A rough line with few bends, close enough to the trail most of the way. Four places (no South Pass). Very short pop-ups. Reason: one word.",
      g: [line(wobble([O.independence.lonlat, FORT_KEARNY, O.chimney.lonlat, O.irock.lonlat, FORT_HALL, BOISE, DALLES, O.oc.lonlat], 15)),
          pt(at("independence", 20), "Independence", "start"), pt(at("chimney", 20), "Chimney Rock", "big rock"),
          pt(at("irock", 20), "Independence Rock", "names on rock"), pt(at("oc", 20), "Oregon City", "end"),
          pt(jitter(NOTE_AT, 150, rnd), "Why", "land")] },
    { file: "Oregon Trail - Sofia_locked.amap", persona: "S2 Sofía (English learner, Spanish speaker)",
      intent: "Complete: line, all five places and a reason with a quotation. Pop-ups mostly in Spanish with some English.",
      g: [line(simplify(route, 8)), pt(at("independence"), "Independence, Missouri", "Aquí empezaba el camino. They bought supplies and oxen."),
          pt(at("chimney"), "Chimney Rock", "Una roca muy alta. Les decía que iban por el camino correcto."),
          pt(at("irock"), "Independence Rock", "Querían llegar antes del 4 de julio, para cruzar las montañas antes de la nieve."),
          pt(at("south"), "South Pass", "Un paso fácil para cruzar las Montañas Rocosas con las carretas."),
          pt(at("oc"), "Oregon City", "El final del camino. Buscaban tierra para granjas."),
          pt(jitter(NOTE_AT, 150, rnd), "¿Por qué fueron al Oeste?", "Mucha gente fue al Oeste por tierra barata. El mapa dice: \"cheap land recently taken from Native Americans\".")] },
    { file: "Oregon Trail - Eli_locked.amap", persona: "S3 Eli (red-green colour vision deficiency)",
      intent: "A strong, complete hand-in: close line, all five places, good explanations and a quoted reason. (The colour difficulty was the volcano task, not this one.)",
      g: [line(simplify(route, 4), "My route", "", "#d7191c"),
          pt(at("independence"), "Independence, Missouri", "The start. Families bought wagons, oxen and food here and left in spring."),
          pt(at("chimney"), "Chimney Rock", "A tall rock you could see from far away, so travelers knew they were on the trail."),
          pt(at("irock"), "Independence Rock", "They wanted to get here by July 4th so they would cross the mountains before snow. People carved their names on it."),
          pt(at("south"), "South Pass", "A wide flat pass through the Rocky Mountains that wagons could use."),
          pt(at("oc"), "Oregon City", "The end of the trail in the Willamette Valley, where families could get farmland."),
          pt(jitter(NOTE_AT, 150, rnd), "Why go West?", "Most people wanted land and a better living. The Trails West layer says they were \"pursuing economic opportunities or cheap land recently taken from Native Americans.\"")] },
    { file: "Oregon Trail - Tariq_locked.amap", persona: "S5 Tariq (blind, uses a screen reader)",
      intent: "No line and no points. Every answer is written, correctly, in one note.",
      g: [pt(NOTE_AT, "My answers (written)", "Independence, Missouri: the start, where people bought supplies and left in spring. Chimney Rock: a landmark that showed they were on the right route. Independence Rock: they tried to reach it by July 4 to beat the snow in the mountains. South Pass: an easy way over the Rocky Mountains for wagons. Oregon City: the end of the trail, with farmland. Why people went West: the Trails West layer says for \"economic opportunities or cheap land\", and some for the gold rush.")] },
    { file: "Oregon Trail - Amara_locked.amap", persona: "S8 Amara (Deaf, uses sign language)",
      intent: "Complete and clear, in short plain sentences. Reason gives two causes with evidence.",
      g: [line(simplify(route, 6)), pt(at("independence"), "Independence, Missouri", "The trail started here. People got ready and left in April or May."),
          pt(at("chimney"), "Chimney Rock", "A tall rock. People could see it from far away. It showed the way."),
          pt(at("irock"), "Independence Rock", "People wanted to arrive by July 4. Then they had time to cross the mountains before snow."),
          pt(at("south"), "South Pass", "A low, wide pass. Wagons could cross the Rocky Mountains here."),
          pt(at("oc"), "Oregon City", "The end of the trail. People got land for farms."),
          pt(jitter(NOTE_AT, 150, rnd), "Why go West", "Two reasons. 1. Cheap land: the layer says \"cheap land recently taken from Native Americans\". 2. Gold: some people wanted \"to get rich in the gold rush\".")] },
    { file: "Oregon Trail - Caleb_locked.amap", persona: "S9 Caleb (dyslexia)",
      intent: "Complete and right, but place names and some words misspelled (Independance, Chimny, Soth Pass, Oregon Citty).",
      g: [line(simplify(route, 6)), pt(at("independence"), "Independance", "the start, they bot suplies"), pt(at("chimney"), "Chimny Rock", "a big rock they could see"),
          pt(at("irock"), "Indapendence Rock", "get there by july 4 befor snow"), pt(at("south"), "Soth Pass", "the way over the rocky mountins"),
          pt(at("oc"), "Oregon Citty", "the end, farm land"), pt(jitter(NOTE_AT, 150, rnd), "Why", "they wanted chepe land and to get rich")] },
    { file: "Oregon Trail - Kayla_locked.amap", persona: "S10 Kayla (attention)",
      intent: "The line stops at Independence Rock. Three places done. No South Pass, no Oregon City, no reason note.",
      g: [line(simplify(upTo(route, O.irock.lonlat), 5)), pt(at("independence"), "Independence, Missouri", "Where the trail starts. People bought supplies."),
          pt(at("chimney"), "Chimney Rock", "A famous rock landmark."), pt(at("irock"), "Independence Rock", "Get here by July 4.")] },
    { file: "Oregon Trail - Devon_locked.amap", persona: "S7 Devon (limited fine motor control, uses the keyboard)",
      intent: "A line of a few long straight sections (clicked with the keyboard), so parts drift from the trail. All five places with dictated sentences and a reason.",
      g: [line([O.independence.lonlat, O.chimney.lonlat, O.irock.lonlat, O.south.lonlat, FORT_HALL, DALLES, O.oc.lonlat]),
          pt(at("independence"), "Independence, Missouri", "This is where the Oregon Trail started and people bought their supplies."),
          pt(at("chimney"), "Chimney Rock", "This rock was a landmark that travelers used to know they were going the right way."),
          pt(at("irock"), "Independence Rock", "Travelers wanted to reach this rock by the Fourth of July so they would not get stuck in snow."),
          pt(at("south"), "South Pass", "This pass let wagons cross the Rocky Mountains."),
          pt(at("oc"), "Oregon City", "This is the end of the trail where people started farms."),
          pt(jitter(NOTE_AT, 150, rnd), "Why did people go West", "People went West for cheap land. The layer says they were pursuing economic opportunities or cheap land.")] },
    { file: "Oregon Trail - Mina_locked.amap", persona: "S6 Mina (low vision, uses magnification)",
      intent: "Zoomed in, she followed the California Trail after Fort Hall, so the last third of her line goes to Sacramento. All five places are in the right spots, with good pop-ups and a reason.",
      g: [line(simplify(upTo(route, FORT_HALL), 3).concat(cal)),
          pt(at("independence"), "Independence, Missouri", "The start of the trail, where people bought what they needed."),
          pt(at("chimney"), "Chimney Rock", "A tall landmark that showed the way along the river."),
          pt(at("irock"), "Independence Rock", "People wanted to get here by July 4 to cross the mountains before winter."),
          pt(at("south"), "South Pass", "The easiest place to cross the Rocky Mountains."),
          pt(at("oc"), "Oregon City", "The end of the Oregon Trail."),
          pt(jitter(NOTE_AT, 150, rnd), "Why go West?", "For land. The layer says people wanted \"economic opportunities or cheap land\".")] }
  ];
  const results = [];
  for (const s of students) {
    const wm = amap(base, s.g, { view: WEST });
    write(path.join(cls, s.file), wm);
    results.push({ file: s.file, persona: s.persona, intent: s.intent, checks: assess(readHandIn(JSON.parse(JSON.stringify(wm))), key) });
  }
  const keyOut = { ...key, route: { ...key.route, paths: "trails-west.json: Oregon" } };
  write(path.join(dir, "key.json"), JSON.stringify(keyOut, null, 1));
  write(path.join(dir, "expected.json"), JSON.stringify({ makeVersion: MAKE_VERSION, checksVersion: CHECKS_VERSION, assignment: "oregon-trail", results }, null, 1));
  return results;
}

const baseV = JSON.parse(fs.readFileSync(path.join(HERE, "base-volcanoes.amap"), "utf8"));
const baseO = JSON.parse(fs.readFileSync(path.join(HERE, "base-oregon-trail.amap"), "utf8"));
for (const d of ["volcanoes", "oregon-trail"]) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
const summary = (r) => r.checks ? `${r.checks.placesFound}/5 places` + (r.checks.route ? `, route ${r.checks.route.drawn ? Math.round(r.checks.route.shareOnRoute * 100) + "% on the trail, reaches " + r.checks.route.reachesCheckpoint : "not drawn"}` : "") + `, ${r.checks.notes.length} note(s), ${r.checks.locked ? "locked" : "NOT locked"}` : "(no checks)";
for (const [name, res] of [["Volcanoes", volcanoes(baseV)], ["Oregon Trail", oregonTrail(baseO)]]) {
  console.log("\n" + name); for (const r of res) console.log("  " + r.file.padEnd(40), summary(r));
}
