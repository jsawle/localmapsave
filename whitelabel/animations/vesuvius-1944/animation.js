// Vesuvius 1944 eruption: a 3D animation plug-in for Map Studio.
// Lava: both 1944 flows (north and south-east) from the lava model's most likely paths, drawn as molten lava.
// Fountains, ash cloud, ash on the ground and sound are an illustration based on accounts of 1944.
// Drawn inside the ArcGIS SceneView with a RenderNode (custom WebGL). RenderNode is experimental in the SDK.
import { LavaModel } from "./lava-model.js";

export const meta = {
  id: "vesuvius-1944",
  title: "Vesuvius 1944 eruption",
  summary: "Watch the March 1944 eruption: two lava flows, lava fountains, then the ash cloud and ash fall. Grades 6-8.",
  version: "0.1",
  models: [
    ["Vesuvius: lava model", "1.0", "DOWNFLOW-style steepest descent with pit filling, 20 m grid"],
    ["Vesuvius: lava look and timing", "0.3", "Both 1944 flows along the most likely paths, 200 m wide, molten look; the northern flow reaches San Sebastiano early on 21 March"],
    ["Vesuvius: ash cloud and fountains", "0.2", "Illustrative particles drawn with a RenderNode"],
    ["Vesuvius: ash on the ground", "0.2", "Illustrative ash-fall lobes: east 22-23 March, south-west 23-29 March"],
    ["Vesuvius: sound", "0.1", "Made in the browser: rumble, roar, explosions, crackling lava"]
  ]
};

const UI = `
  <div class="erupt" style="display:flex;flex-direction:column;gap:8px">
    <div id="eDate" style="font-weight:700;font-size:17px;font-variant-numeric:tabular-nums">18 March 1944, 16:30</div>
    <input id="eScrub" type="range" min="0" max="1000" value="0" aria-label="Eruption timeline" disabled style="width:100%" />
    <div style="display:flex;gap:8px"><button id="ePlay" class="btn primary" disabled>▶ Play the eruption</button><button id="eRestart" class="btn" disabled>Restart</button></div>
    <p id="ePhase" style="margin:0;font-size:14px;min-height:4.2em">Loading terrain…</p>
    <div style="height:4px;background:var(--chip);border-radius:2px;overflow:hidden"><div id="eProg" style="height:100%;width:0;background:var(--brand)"></div></div>
    <label><input type="checkbox" id="eCloud" checked /> Ash cloud and lava fountains <span class="ver">v0.2</span></label>
    <label><input type="checkbox" id="eGround" checked /> Ash on the ground <span class="ver">v0.2</span></label>
    <label><input type="checkbox" id="eSound" checked /> Sound <span class="ver">v0.1</span></label>
    <p class="hint" style="margin:0">The lava's paths come from the lava model <span class="ver">v1.0</span>, drawn as molten lava <span class="ver">v0.3</span>. The fountains, ash cloud and ash on the ground are an <b>illustration</b> based on accounts of 1944. They are not modelled.</p>
    <details><summary class="hint">What happened in March 1944?</summary><p class="hint">Two lava flows left the crater on 18 March. The northern one was turned west by Monte Somma and reached San Sebastiano and Massa di Somma early on 21 March, stopping at about 140 m above sea level. The south-eastern one stopped at about 350 m. Lava fountains followed on 21-22 March, then explosions until 29 March, with ash falling to the east and south-east. Source: INGV Osservatorio Vesuviano.</p></details>
  </div>`;

export async function start(ctx) {
  const { view, map, container } = ctx;
  const [Graphic, GraphicsLayer, Extent, RenderNode, webgl, SpatialReference] = await $arcgis.import([
    "@arcgis/core/Graphic.js", "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/geometry/Extent.js",
    "@arcgis/core/views/3d/webgl/RenderNode.js", "@arcgis/core/views/3d/webgl.js", "@arcgis/core/geometry/SpatialReference.js"
  ]);
  container.innerHTML = UI;
  const $ = (id) => container.querySelector("#" + id);
  let disposed = false, busy = true;

  // ---------- Grid (Web Mercator, 20 m true cells) ----------
  const CRATER = { lon: 14.4269, lat: 40.8211 };
  const GRID = { lonMin: 14.32, lonMax: 14.50, latMin: 40.76, latMax: 40.87, cell: 20 };
  const FLOWS = [
    { key: "north", lon: 14.4269, lat: 40.8252, stop: 140 },        // turned west by Monte Somma into San Sebastiano and Massa di Somma
    { key: "southeast", lon: 14.4307, lat: 40.8182, stop: 350 }     // stopped at about 350 m before reaching any town
  ];
  const LAVA_WIDTH = 200;
  const PLACES = [["San Sebastiano al Vesuvio", 14.3704, 40.8418], ["Massa di Somma", 14.3753, 40.8483], ["Ercolano", 14.3474, 40.8059],
    ["Torre del Greco", 14.3657, 40.7867], ["Boscotrecase", 14.4611, 40.7744], ["Terzigno", 14.4936, 40.8092], ["Pompei", 14.4990, 40.7489]];
  const R = 6378137;
  const toMerc = (lon, lat) => [lon * Math.PI / 180 * R, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
  const fromMerc = (x, y) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
  const latC = (GRID.latMin + GRID.latMax) / 2, cellM = GRID.cell / Math.cos(latC * Math.PI / 180);
  const [xmin, ymin] = toMerc(GRID.lonMin, GRID.latMin), [xmax0, ymax0] = toMerc(GRID.lonMax, GRID.latMax);
  const W = Math.floor((xmax0 - xmin) / cellM), H = Math.floor((ymax0 - ymin) / cellM), ymax = ymin + H * cellM, xmax = xmin + W * cellM;
  const idxOf = (lon, lat) => { const [x, y] = toMerc(lon, lat); const i = Math.floor((x - xmin) / cellM), j = Math.floor((ymax - y) / cellM); return (i < 0 || j < 0 || i >= W || j >= H) ? -1 : j * W + i; };
  const cellCenter = (idx) => { const i = idx % W, j = (idx / W) | 0; return [xmin + (i + 0.5) * cellM, ymax - (j + 0.5) * cellM]; };
  let heights = null;

  // Place names
  const placeLayer = new GraphicsLayer({ title: "Vesuvius 1944 places", listMode: "hide", elevationInfo: { mode: "relative-to-ground" } });
  for (const [name, lon, lat] of PLACES) {
    const [x, y] = toMerc(lon, lat);
    placeLayer.add(new Graphic({ geometry: { type: "point", x, y, spatialReference: { wkid: 3857 } }, symbol: { type: "point-3d", symbolLayers: [
      { type: "icon", size: 7, resource: { primitive: "circle" }, material: { color: "#1f2937" }, outline: { color: "white", size: 1 } },
      { type: "text", text: name, size: 11, material: { color: "white" }, halo: { color: [0, 0, 0, 0.75], size: 1.4 }, verticalAlignment: "bottom", font: { weight: "bold" } }],
      verticalOffset: { screenLength: 16, maxWorldLength: 400, minWorldLength: 20 }, callout: { type: "line", size: 1, color: [255, 255, 255, 0.9] } } }));
  }
  map.add(placeLayer);

  // Timeline in hours from 00:00 on 18 March 1944 (same as the VR version)
  const T = { start: 16.5,              // 16:30, 18 March: lava flows begin
    fountains: 3 * 24 + 17,             // about 17:00, 21 March: lava fountains
    column: 4 * 24 + 14,                // afternoon of 22 March: explosions, column over 5 km, ash east
    phase4: 5 * 24 + 12,                // from 12:00, 23 March: smaller explosions, ash south-west
    end: 12 * 24 };                     // end of 29 March
  // Seconds of playback given to each phase (the lava phase gets the most)
  const SEG = [[T.start, T.fountains, 26], [T.fountains, T.column, 12], [T.column, T.phase4, 14], [T.phase4, T.end, 12]];
  const PLAY_S = SEG.reduce((s, g) => s + g[2], 0);
  function hoursAt(sec) { let s = sec; for (const [a, b, d] of SEG) { if (s <= d) return a + (b - a) * s / d; s -= d; } return T.end; }
  function fmtDate(h) { const day = 18 + Math.floor(h / 24), hh = Math.floor(h % 24), mm = Math.floor((h % 1) * 60 / 10) * 10;
    return `${day} March 1944, ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`; }

  const ASH_AXIS_E = 112, ASH_AXIS_W = 225;   // downwind bearings (degrees): east over Terzigno–Pompei–Cava, then south-west
  const FOUNTAIN_N = 8;                       // eight successive lava fountains
  function stateAt(h) {
    const s = { phase: 0, ashRate: 0, ftnRate: 0, top: 0, windB: ASH_AXIS_E, windV: 0, heat: 0, glow: 0, ashE: 0, ashW: 0, rumble: 0.25, roar: 0, booms: 0 };
    if (h < T.start) return s;
    if (h < T.fountains) { s.phase = 1; s.glow = 0.25; }
    else if (h < T.column) { s.phase = 2; const f = (h - T.fountains) / (T.column - T.fountains), pulse = Math.pow(Math.max(0, Math.sin(f * FOUNTAIN_N * Math.PI)), 0.6);
      s.ftnRate = 60 + 520 * pulse; s.ashRate = 90 + 160 * pulse; s.top = 4000; s.windV = 900; s.heat = 0.5; s.glow = 0.4 + 0.8 * pulse; s.rumble = 0.45 + 0.3 * pulse; s.roar = 0.12 + 0.35 * pulse; }
    else if (h < T.phase4) { s.phase = 3; const f = (h - T.column) / (T.phase4 - T.column);
      s.ashRate = 380; s.top = 6000; s.windV = 2200; s.heat = 0.15; s.glow = 0.3; s.ashE = f; s.rumble = 0.8; s.roar = 0.45; s.booms = 0.8; }
    else if (h < T.end) { s.phase = 4; const f = (h - T.phase4) / (T.end - T.phase4), burst = Math.pow(Math.max(0, Math.sin(f * 14 * Math.PI)), 3) * (1 - f * 0.6);
      s.ashRate = 220 * burst; s.top = 3000; s.windB = ASH_AXIS_W; s.windV = 1500; s.glow = 0.1; s.ashE = 1; s.ashW = f; s.rumble = 0.2 + 0.4 * burst; s.roar = 0.2 * burst; s.booms = 0.5 * burst; }
    else { s.phase = 5; s.ashE = 1; s.ashW = 1; s.rumble = 0; }
    return s;
  }
  const PHASE_TEXT = [
    "Press Play to watch the eruption of March 1944.",
    "<b>Lava flows.</b> Two flows left the crater. The northern one was turned west by Monte Somma and moved at 50–300 m an hour towards San Sebastiano and Massa di Somma. The lava you see comes from the model.",
    "<b>Lava fountains.</b> Eight fountains of lava, one after another, threw material up to about 4 km.",
    "<b>Explosions.</b> An eruption column more than 5 km high. The wind carried ash 15–20 km east over Terzigno, Pompei, Scafati, Angri, Nocera, Poggiomarino and Cava, and damaged dozens of B-25 bombers at a nearby airfield.",
    "<b>Smaller explosions.</b> Ash plumes blew to the south-west, until the eruption ended on 29 March.",
    "<b>The end of the eruption.</b> Vesuvius has not erupted since. It is dormant, not extinct."
  ];

  // Local frame: metres east (x), north (y) and up (z) from the crater. Web Mercator distances are true distance / cos(lat).
  const COSLAT = Math.cos(CRATER.lat * Math.PI / 180);
  const [CXM, CYM] = toMerc(CRATER.lon, CRATER.lat);
  function hAt(x, y) {
    if (!heights) return 0;
    const i = Math.floor((CXM + x / COSLAT - xmin) / cellM), j = Math.floor((ymax - (CYM + y / COSLAT)) / cellM);
    if (i < 0 || j < 0 || i >= W || j >= H) return 0;          // outside the lava grid: the plain and the bay, near sea level
    const v = heights[j * W + i]; return isFinite(v) && v > 0 ? v : 0;
  }
  let craterZ = 1200;
  function findCraterTop() {
    const c = idxOf(CRATER.lon, CRATER.lat), ci = c % W, cj = (c / W) | 0, r = Math.round(400 / GRID.cell); let top = 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < W && j < H && isFinite(heights[j * W + i])) top = Math.max(top, heights[j * W + i]); }
    if (top > 0) craterZ = top;
  }

  // ---------- Particles (same behaviour as the VR version, in the local frame) ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  function makeSystem(n) {
    return { n, next: 0, acc: 0, wind: [0, 0], P: new Float32Array(n * 3), D: new Float32Array(n * 4),
      x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), vx: new Float64Array(n), vy: new Float64Array(n), vz: new Float64Array(n),
      age: new Float64Array(n).fill(1e9), life: new Float64Array(n), st: new Uint8Array(n), top: new Float64Array(n), heat0: new Float64Array(n) };
  }
  const ash = makeSystem(3000), ftn = makeSystem(901);           // the last fountain slot is the crater glow
  const GLOW = ftn.n - 1;
  function clearParticles() { for (const p of [ash, ftn]) { p.age.fill(1e9); p.D.fill(0); p.acc = 0; } }
  function emitAsh(st) {
    const p = ash, k = p.next; p.next = (k + 1) % p.n;
    const a = rnd(0, Math.PI * 2), r = rnd(0, 180);
    p.x[k] = Math.cos(a) * r; p.y[k] = Math.sin(a) * r; p.z[k] = craterZ + 30;
    p.vx[k] = rnd(-60, 60); p.vy[k] = rnd(-60, 60); p.vz[k] = st.top / rnd(1.2, 1.8);
    p.age[k] = 0; p.life[k] = rnd(6, 9); p.st[k] = 0; p.top[k] = st.top * rnd(0.8, 1.05);
    p.heat0[k] = st.heat; p.D[k * 4 + 2] = st.heat; p.D[k * 4 + 3] = Math.random();
    p.wind = [Math.sin(st.windB * Math.PI / 180) * st.windV, Math.cos(st.windB * Math.PI / 180) * st.windV];
  }
  function emitFountain() {
    const p = ftn, k = p.next; p.next = (k + 1) % GLOW;
    p.x[k] = rnd(-90, 90); p.y[k] = rnd(-90, 90); p.z[k] = craterZ;
    p.vx[k] = rnd(-110, 110); p.vy[k] = rnd(-110, 110); p.vz[k] = rnd(420, 820); p.age[k] = 0; p.life[k] = 3.2;
  }
  const LIMIT = 30000;
  function stepParticles(dt, st) {
    if (st.ashRate > 0) { ash.acc += st.ashRate * dt; while (ash.acc >= 1) { emitAsh(st); ash.acc--; } }
    if (st.ftnRate > 0) { ftn.acc += st.ftnRate * dt; while (ftn.acc >= 1) { emitFountain(); ftn.acc--; } }
    // ash: rises in a column, spreads under its top, drifts downwind and settles
    const p = ash, [wx, wy] = p.wind;
    for (let k = 0; k < p.n; k++) {
      const o = k * 4; if (p.age[k] > p.life[k]) { p.D[o + 1] = 0; continue; }
      p.age[k] += dt; const ztop = craterZ + p.top[k];
      if (p.st[k] === 0 && p.z[k] >= ztop) { p.st[k] = 1; const a = Math.atan2(p.y[k], p.x[k]) + rnd(-0.6, 0.6);
        p.vx[k] = Math.cos(a) * rnd(300, 900); p.vy[k] = Math.sin(a) * rnd(300, 900); p.vz[k] = -p.top[k] / rnd(5, 8); }
      if (p.st[k] === 1) { p.vx[k] += (wx - p.vx[k]) * Math.min(1, dt * 0.8); p.vy[k] += (wy - p.vy[k]) * Math.min(1, dt * 0.8); }
      else { p.vx[k] += wx * 0.15 * dt; p.vy[k] += wy * 0.15 * dt; }
      p.x[k] += p.vx[k] * dt; p.y[k] += p.vy[k] * dt; p.z[k] += p.vz[k] * dt;
      const g = hAt(p.x[k], p.y[k]);
      if (Math.abs(p.x[k]) > LIMIT || Math.abs(p.y[k]) > LIMIT || p.z[k] < g + 40) { p.age[k] = 1e9; p.D[o + 1] = 0; continue; }
      p.P[k * 3] = p.x[k]; p.P[k * 3 + 1] = p.y[k]; p.P[k * 3 + 2] = p.z[k];
      const f = p.age[k] / p.life[k];
      p.D[o] = (p.st[k] === 0 ? 550 + 700 * f : 1100 + 1700 * f) * (0.75 + 0.5 * p.D[o + 3]);   // size in metres, varied per puff
      p.D[o + 1] = Math.min(1, p.age[k] / 0.3) * (1 - Math.max(0, (f - 0.7) / 0.3)) * (p.st[k] === 0 ? 0.8 : 0.45) * Math.min(1, (p.z[k] - g) / 400);
      p.D[o + 2] = p.st[k] === 0 ? p.heat0[k] * Math.max(0, 1 - (p.z[k] - craterZ) / 900) : p.D[o + 2] * 0.85;   // glow only low in the column
    }
    // fountains: glowing lava thrown up and falling back
    const q = ftn;
    for (let k = 0; k < GLOW; k++) {
      const o = k * 4; if (q.age[k] > q.life[k]) { q.D[o + 1] = 0; continue; }
      q.age[k] += dt; q.vz[k] -= 380 * dt; q.x[k] += q.vx[k] * dt; q.y[k] += q.vy[k] * dt; q.z[k] += q.vz[k] * dt;
      if (q.z[k] < hAt(q.x[k], q.y[k])) { q.age[k] = 1e9; q.D[o + 1] = 0; continue; }
      q.P[k * 3] = q.x[k]; q.P[k * 3 + 1] = q.y[k]; q.P[k * 3 + 2] = q.z[k];
      const f = q.age[k] / q.life[k]; q.D[o] = 80 + 50 * (1 - f); q.D[o + 1] = 0.35 * (1 - f * 0.6); q.D[o + 2] = Math.max(0, 1 - f * 1.4);
    }
  }
  function setGlow(st, now) {
    const o = GLOW * 4; ftn.P[GLOW * 3] = 0; ftn.P[GLOW * 3 + 1] = 0; ftn.P[GLOW * 3 + 2] = craterZ + 250;
    ftn.D[o] = 900 + 600 * st.glow; ftn.D[o + 1] = Math.min(1, st.glow) * (0.8 + 0.2 * Math.sin(now / 90) * Math.sin(now / 37)) * 0.22; ftn.D[o + 2] = 0.6; ftn.D[o + 3] = 1;
  }

  // ---------- WebGL (RenderNode) ----------
  const VS = `#version 300 es
  in vec2 aCorner; in vec3 iPos; in vec4 iData;
  uniform mat4 uMV; uniform mat4 uP;
  out vec2 vUv; out vec4 vD;
  void main() {
    vUv = aCorner + 0.5; vD = iData;
    vec4 mv = uMV * vec4(iPos, 1.0);
    mv.xy += aCorner * (iData.y > 0.0 ? iData.x : 0.0);
    gl_Position = uP * mv;
  }`;
  // Colours are sRGB. uMode 0 = ash (premultiplied "over"), 1 = glowing lava (added light).
  const FS = `#version 300 es
  precision highp float;
  in vec2 vUv; in vec4 vD; uniform int uMode; out vec4 o;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (uMode == 0) {
      vec2 d = vUv - 0.5; float ang = atan(d.y, d.x) + vD.w * 6.2832;
      float edge = 0.78 + 0.12 * sin(ang * 3.0 + vD.w * 11.0) + 0.08 * sin(ang * 7.0 - vD.w * 5.0);
      float a = smoothstep(edge, edge * 0.3, r) * vD.y; if (a < 0.01) discard;
      float shade = clamp(vUv.y * 0.8 + vD.w * 0.35 - r * 0.25, 0.0, 1.0);
      vec3 c = mix(vec3(0.30, 0.28, 0.26), vec3(0.66, 0.63, 0.59), shade);
      c = mix(c, vec3(0.95, 0.42, 0.12), vD.z * 0.8);
      o = vec4(c * a, a);
    } else {
      float a = smoothstep(1.0, 0.0, r) * vD.y; if (a < 0.01) discard;
      vec3 c = mix(vec3(0.95, 0.30, 0.04), vec3(1.0, 0.80, 0.40), vD.z);
      o = vec4(c * a, a);
    }
  }`;
  function mul4(out, a, b) {   // column-major 4x4: out = a * b, in double precision
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return out;
  }


  let lavaSurf = null;
  const LAVA_T = { townArrival: 3 * 24 + 6, thick: 6 };
  function lavaFront(h) {                     // how much lava arrived in the last 1.5 hours (for the crackling)
    const a = lavaSurf && lavaSurf.arrivals; if (!a || !a.length) return 0;
    const lo = (x) => { let l = 0, r = a.length; while (l < r) { const m = (l + r) >> 1; if (a[m] < x) l = m + 1; else r = m; } return l; };
    return Math.min(1, (lo(h) - lo(h - 1.5)) / 40);
  }
  const LAVA_VS = `#version 300 es
  in vec3 aPos; in vec3 aNrm; in vec2 aLava;
  uniform mat4 uMV; uniform mat4 uP; uniform float uT;
  out vec2 vXY; out vec3 vN; out vec2 vL;
  void main() {
    vXY = aPos.xy; vN = aNrm; vL = aLava;
    vec3 p = aPos;
    p.z += 2.0 + ${LAVA_T.thick.toFixed(1)} * smoothstep(0.3, 0.7, aLava.y) * smoothstep(aLava.x, aLava.x + 0.35, uT);
    vec4 mv = uMV * vec4(p, 1.0);
    mv.xyz *= 0.996;                          // nudge towards the camera so the lava sits on the ArcGIS terrain at any zoom
    gl_Position = uP * mv;
  }`;
  const LAVA_FS = `#version 300 es
  precision highp float;
  in vec2 vXY; in vec3 vN; in vec2 vL;
  uniform float uT; uniform float uClock;
  out vec4 o;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    float inside = smoothstep(0.3, 0.7, vL.y);
    float reveal = smoothstep(vL.x, vL.x + 0.35, uT);                      // soft front, about 20 minutes wide
    float a = inside * reveal; if (a < 0.01) discard;
    float age = max(0.0, uT - vL.x);                                       // hours since the lava arrived
    vec3 c = mix(vec3(1.0, 0.93, 0.55), vec3(1.0, 0.45, 0.06), smoothstep(0.0, 1.5, age));
    c = mix(c, vec3(0.62, 0.08, 0.02), smoothstep(1.5, 8.0, age));
    c = mix(c, vec3(0.30, 0.12, 0.08), smoothstep(8.0, 60.0, age));        // cooled crust: dark red-brown
    float n = vnoise(vXY / 28.6 + vec2(0.0, uClock * 0.3)) * 0.6 + vnoise(vXY / 9.5 - uClock * 0.2) * 0.4;
    float cracks = smoothstep(0.60, 0.72, n) * smoothstep(6.0, 16.0, age) * exp(-age / 120.0);   // glowing cracks for days
    c = mix(c, vec3(1.0, 0.38, 0.05), cracks);
    float lit = 0.55 + 0.45 * max(dot(normalize(vN), normalize(vec3(-0.5, 0.35, 0.8))), 0.0), hot = 1.0 - smoothstep(4.0, 20.0, age);
    c = mix(c * lit, c * (1.0 + 0.25 * (n - 0.5)), hot);                  // hot lava glows; the crust is lit like the ground
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));                          // linear to sRGB (the VR version's colours)
    o = vec4(c * a, a);
  }`;

  // ---------- Sound (made in the browser, no recordings; from the VR version) ----------
  const snd = { ctx: null, on: true };
  function initSound() {
    if (snd.ctx) { if (snd.ctx.state !== "running") snd.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC(); snd.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = snd.on ? 0.9 : 0; snd.master = master;
    const pan = ctx.createStereoPanner(); pan.connect(master); master.connect(ctx.destination); snd.pan = pan;
    const dist = ctx.createGain(); dist.gain.value = 1; dist.connect(pan); snd.dist = dist;     // quieter when the camera is far away
    const noise = (seconds, brown) => { const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0); let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; } return b; };
    const loop = (buf, filterType, freq, q) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(dist); s.start(); return g; };
    const brown = noise(4, true), white = noise(2, false);
    snd.rumble = loop(brown, "lowpass", 110, 0.7);        // deep rumble of the volcano
    snd.roar = loop(white, "bandpass", 420, 0.6);         // roar of the fountains and the column
    snd.crackleBuf = white; snd.nextCrackle = 0; snd.nextBoom = 0;
  }
  function crackle(ctx, t, gain) {
    const s = ctx.createBufferSource(); s.buffer = snd.crackleBuf; const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = rnd(1800, 4000);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + rnd(0.01, 0.04));
    s.connect(f); f.connect(g); g.connect(snd.dist); s.start(t, Math.random() * 1.5, 0.06);
  }
  function boom(ctx, t, gain) {
    const s = ctx.createBufferSource(); s.buffer = snd.crackleBuf; const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 180;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    s.connect(f); f.connect(g); g.connect(snd.dist); s.start(t, Math.random(), 1.9);
  }
  function stepSound(st, front, playing) {
    const ctx = snd.ctx; if (!ctx) return;
    const t = ctx.currentTime, k = playing ? 1 : 0, cam = view.camera, p = cam.position;
    // distance and direction from the camera to the crater: volume and left/right balance
    const dx = (p.longitude - CRATER.lon) * 111320 * COSLAT, dy = (p.latitude - CRATER.lat) * 110540, dz = (p.z || 0) - craterZ;
    const d = Math.max(500, Math.hypot(dx, dy, dz)), bearing = Math.atan2(-dx, -dy), rel = bearing - cam.heading * Math.PI / 180;
    snd.dist.gain.setTargetAtTime(Math.min(1.2, 7000 / d), t, 0.2);
    snd.pan.pan.setTargetAtTime(0.8 * Math.sin(rel), t, 0.2);
    snd.rumble.gain.setTargetAtTime(k * st.rumble, t, 0.3); snd.roar.gain.setTargetAtTime(k * st.roar, t, 0.3);
    if (playing && front > 0 && t > snd.nextCrackle) { crackle(ctx, t + 0.01, 0.35 * front); snd.nextCrackle = t + rnd(0.02, 0.12) / Math.max(0.2, front); }
    if (playing && st.booms > 0 && t > snd.nextBoom) { boom(ctx, t + 0.02, 0.9 * st.booms); snd.nextBoom = t + rnd(0.8, 2.6) / st.booms; }
  }
  function setSound(on) {
    snd.on = on; if (on) initSound();
    if (snd.master) snd.master.gain.setTargetAtTime(on ? 0.9 : 0, snd.ctx.currentTime, 0.05);
  }

  const pb = { sec: 0, playing: false, last: 0, phase: -1, lavaShown: 0 };
  const opts = { cloud: true, ground: true };

  const EruptionNode = RenderNode.createSubclass({
    initialize() {
      this.consumes.required.push("transparent-color");
      this.produces = "transparent-color";
      this.MV = new Float64Array(16); this.MV32 = new Float32Array(16); this.local = new Float64Array(16);
    },
    setup(gl) {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.prog = p;
      const pl = gl.createProgram(); gl.attachShader(pl, sh(gl.VERTEX_SHADER, LAVA_VS)); gl.attachShader(pl, sh(gl.FRAGMENT_SHADER, LAVA_FS)); gl.linkProgram(pl);
      if (!gl.getProgramParameter(pl, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pl));
      this.lprog = pl;
      this.lloc = { pos: gl.getAttribLocation(pl, "aPos"), nrm: gl.getAttribLocation(pl, "aNrm"), lava: gl.getAttribLocation(pl, "aLava"),
        mv: gl.getUniformLocation(pl, "uMV"), proj: gl.getUniformLocation(pl, "uP"), t: gl.getUniformLocation(pl, "uT"), clock: gl.getUniformLocation(pl, "uClock") };
      this.loc = { corner: gl.getAttribLocation(p, "aCorner"), pos: gl.getAttribLocation(p, "iPos"), data: gl.getAttribLocation(p, "iData"),
        mv: gl.getUniformLocation(p, "uMV"), proj: gl.getUniformLocation(p, "uP"), mode: gl.getUniformLocation(p, "uMode") };
      const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
      this.sys = [ash, ftn].map(s => {
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(this.loc.corner); gl.vertexAttribPointer(this.loc.corner, 2, gl.FLOAT, false, 0, 0);
        const pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pos); gl.bufferData(gl.ARRAY_BUFFER, s.P.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.loc.pos); gl.vertexAttribPointer(this.loc.pos, 3, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(this.loc.pos, 1);
        const dat = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, dat); gl.bufferData(gl.ARRAY_BUFFER, s.D.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.loc.data); gl.vertexAttribPointer(this.loc.data, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(this.loc.data, 1);
        gl.bindVertexArray(null);
        return { s, vao, pos, dat };
      });
    },
    uploadLava(gl) {
      const L = lavaSurf, lc = this.lloc;
      if (!this.lvao) { this.lvao = gl.createVertexArray(); this.lbuf = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()]; this.libuf = gl.createBuffer(); }
      gl.bindVertexArray(this.lvao);
      [[L.pos, lc.pos, 3], [L.nrm, lc.nrm, 3], [L.lav, lc.lava, 2]].forEach(([data, loc, size], i) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lbuf[i]); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); });
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.libuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, L.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.lavaVer = L.ver; this.lavaCount = L.idx.length;
    },
    render(inputs) {
      const fbo = this.bindRenderTarget();
      const gl = this.gl;
      if (disposed) return fbo;
      try {
        if (!this.prog) this.setup(gl);
        const now = performance.now();
        tick(now);
        const showLava = pb.active && lavaSurf;
        if ((opts.cloud || showLava) && heights) {
          webgl.renderCoordinateTransformAt(this.view, [CXM, CYM, 0], SpatialReference.WebMercator, this.local);
          mul4(this.MV, this.camera.viewMatrix, this.local); this.MV32.set(this.MV);
          const emissive = fbo.getAttachment(gl.COLOR_ATTACHMENT1);
          if (emissive) gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
          gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND);
          if (showLava) {
            if (this.lavaVer !== lavaSurf.ver) this.uploadLava(gl);
            gl.useProgram(this.lprog);
            gl.uniformMatrix4fv(this.lloc.mv, false, this.MV32);
            gl.uniformMatrix4fv(this.lloc.proj, false, this.camera.projectionMatrix);
            gl.uniform1f(this.lloc.t, hoursAt(pb.sec)); gl.uniform1f(this.lloc.clock, now / 1000);
            gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
            gl.bindVertexArray(this.lvao); gl.drawElements(gl.TRIANGLES, this.lavaCount, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null);
          }
        }
        if (opts.cloud && heights) {
          gl.useProgram(this.prog);
          gl.uniformMatrix4fv(this.loc.mv, false, this.MV32);
          gl.uniformMatrix4fv(this.loc.proj, false, this.camera.projectionMatrix);
          this.sys.forEach(({ s, vao, pos, dat }, i) => {
            gl.bindBuffer(gl.ARRAY_BUFFER, pos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.P);
            gl.bindBuffer(gl.ARRAY_BUFFER, dat); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.D);
            if (i === 0) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);   // ash over the scene
            else gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);                         // glowing lava adds light
            gl.uniform1i(this.loc.mode, i);
            gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.n);
          });
          gl.bindVertexArray(null);
        }
        if ((opts.cloud || showLava) && heights && fbo.getAttachment(gl.COLOR_ATTACHMENT1)) gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      } catch (e) {
        if (!this.failed) { this.failed = true; console.error("Eruption animation failed", e); $("ePhase").textContent = "The lava and ash cloud couldn't be drawn on this device. Run the model to see the lava as a hazard map."; }
      }
      this.resetWebGLState();
      if (pb.playing || (pb.active && lavaSurf)) this.requestRender();   // keep the cracks glowing while the lava is shown
      return fbo;
    }
  });

  // ---------- Ash on the ground (illustration) ----------
  const ASHG = { lonMin: 14.28, lonMax: 14.76, latMin: 40.60, latMax: 40.93, cell: 250 };
  const ASH_CLASSES = [0.1, 0.3, 0.55, 0.8], ASH_ALPHA = [0.18, 0.32, 0.46, 0.62];
  const ashLayers = {
    E: new GraphicsLayer({ title: "Ash fall to the east, 22–23 March (illustration)", elevationInfo: { mode: "on-the-ground" } }),
    W: new GraphicsLayer({ title: "Ash fall to the south-west, 23–29 March (illustration)", elevationInfo: { mode: "on-the-ground" } })
  };
  map.addMany([ashLayers.E, ashLayers.W], 0);   // under the lava          // under the lava
  function lobe(dx, dy, bearing, len, width0) {
    const b = bearing * Math.PI / 180, ax = Math.sin(b), ay = Math.cos(b);
    const along = dx * ax + dy * ay, across = -dx * ay + dy * ax; if (along < -1500) return 0;
    const sig = width0 + 0.35 * Math.max(0, along), f = Math.exp(-(across * across) / (2 * sig * sig));
    return f * Math.min(1, (along + 1500) / 2500) * Math.exp(-Math.max(0, along) / len);
  }
  function buildAshGround() {
    const cm = ASHG.cell / COSLAT, [x0, y0] = toMerc(ASHG.lonMin, ASHG.latMin), [x1, y1] = toMerc(ASHG.lonMax, ASHG.latMax);
    const nx = Math.floor((x1 - x0) / cm), ny = Math.floor((y1 - y0) / cm);
    const fns = { E: (dx, dy) => Math.min(1, 1.29 * lobe(dx, dy, ASH_AXIS_E, 12000, 2200)), W: (dx, dy) => Math.min(1, 0.7 * lobe(dx, dy, ASH_AXIS_W, 6000, 1200)) };
    for (const key of ["E", "W"]) {
      const rings = ASH_CLASSES.map(() => []), cls = (v) => { let c = -1; for (let k = 0; k < ASH_CLASSES.length; k++) if (v >= ASH_CLASSES[k]) c = k; return c; };
      for (let j = 0; j < ny; j++) {
        const yb = y0 + j * cm, yc = yb + cm / 2; let i = 0;
        const clsAt = (ii) => cls(fns[key]((x0 + (ii + 0.5) * cm - CXM) * COSLAT, (yc - CYM) * COSLAT));
        while (i < nx) {
          const c = clsAt(i); if (c < 0) { i++; continue; }
          let e = i + 1; while (e < nx && clsAt(e) === c) e++;
          const xa = x0 + i * cm, xb = x0 + e * cm;
          rings[c].push([[xa, yb], [xa, yb + cm], [xb, yb + cm], [xb, yb], [xa, yb]]);
          i = e;
        }
      }
      ashLayers[key].addMany(rings.map((r, c) => r.length && new Graphic({
        geometry: { type: "polygon", rings: r, spatialReference: { wkid: 3857 } },
        symbol: ashSymbol(c, 0), attributes: { cls: c }
      })).filter(Boolean));
      console.info("Ash on the ground", key, ashLayers[key].graphics.length, "graphics,", rings.reduce((n, r) => n + r.length, 0), "rectangles");
    }
  }
  function ashSymbol(c, v) { return { type: "simple-fill", color: [58, 54, 50, ASH_ALPHA[c] * v], outline: { width: 0 } }; }
  let ashOpacity = { E: -1, W: -1 };
  function setAshGround(st) {
    for (const k of ["E", "W"]) {
      const v = opts.ground ? Math.round((k === "E" ? st.ashE : st.ashW) * 20) / 20 : 0;   // 5% steps: few symbol updates
      if (v === ashOpacity[k]) continue;
      ashOpacity[k] = v; ashLayers[k].visible = v > 0;
      for (const g of ashLayers[k].graphics.toArray()) g.symbol = ashSymbol(g.attributes.cls, v);
    }
  }

  // ---------- Playback ----------
  function tick(now) {
    const dt = Math.min(0.05, (now - (pb.last || now)) / 1000); pb.last = now;
    if (!heights) return;
    if (pb.playing) { pb.sec = Math.min(PLAY_S, pb.sec + dt); if (pb.sec >= PLAY_S) setPlaying(false); }
    const h = hoursAt(pb.sec), st = stateAt(h);
    if (pb.playing) stepParticles(dt, st);
    setGlow(st, now);
    setAshGround(st);
    stepSound(st, pb.active ? lavaFront(h) : 0, pb.playing && snd.on);
    const date = fmtDate(h); if (date !== pb.date) { pb.date = date; $("eDate").textContent = date; }
    if (st.phase !== pb.phase) { pb.phase = st.phase; $("ePhase").innerHTML = PHASE_TEXT[st.phase]; }
    if (!pb.scrubbing) $("eScrub").value = Math.round(pb.sec / PLAY_S * 1000);
  }
  function setPlaying(v) {
    pb.playing = v; $("ePlay").textContent = v ? "❚❚ Pause" : pb.sec >= PLAY_S ? "▶ Play again" : "▶ Play the eruption";
    if (v) node.requestRender();
  }

  // ---------- Lava: both 1944 flows along their most likely paths ----------
  function buildLavaSurface(flows) {
    const n = W * H, mask = new Uint8Array(n), dist = new Float64Array(n).fill(Infinity);
    const rad = Math.max(GRID.cell, LAVA_WIDTH / 2), Rc = Math.ceil(rad / GRID.cell);
    let townDist = Infinity;
    const c0 = idxOf(PLACES[0][1], PLACES[0][2]), ti = c0 % W, tj = (c0 / W) | 0, rr = Math.round(400 / GRID.cell);
    for (const f of flows) {
      const path = f.res.bestPath || []; if (!path.length) continue;
      const along = new Float64Array(path.length);
      for (let k = 1; k < path.length; k++) along[k] = along[k - 1] + Math.hypot((path[k] % W) - (path[k - 1] % W), ((path[k] / W) | 0) - ((path[k - 1] / W) | 0)) * GRID.cell;
      const put = (c, d) => { if (heights[c] > 0 && d < dist[c]) { dist[c] = d; mask[c] = 1; } };
      path.forEach((c, k) => { const ci = c % W, cj = (c / W) | 0;
        if (f.key === "north" && Math.abs(ci - ti) <= rr && Math.abs(cj - tj) <= rr) townDist = Math.min(townDist, along[k]);
        for (let dj = -Rc; dj <= Rc; dj++) for (let di = -Rc; di <= Rc; di++) { const i = ci + di, j = cj + dj;
          if (i >= 0 && j >= 0 && i < W && j < H && Math.hypot(di, dj) * GRID.cell <= rad) put(j * W + i, along[k]); } });
      for (const p of f.res.bestPonds || []) { const k = path.indexOf(p.outlet), d = k >= 0 ? along[k] : 0; for (const c of p.cells) put(c, d); }
    }
    // Speed: the northern flow reaches San Sebastiano early on 21 March (recorded); otherwise 85 m/h. Both flows share it.
    const speed = isFinite(townDist) && townDist > 0 ? townDist / (LAVA_T.townArrival - T.start) : 85;
    const arr = new Float64Array(n).fill(Infinity); let i0 = W, i1 = -1, j0 = H, j1 = -1;
    for (let c = 0; c < n; c++) if (mask[c]) { arr[c] = T.start + dist[c] / speed; const i = c % W, j = (c / W) | 0;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    if (i1 < 0) return null;
    i0 = Math.max(0, i0 - 2); j0 = Math.max(0, j0 - 2); i1 = Math.min(W - 1, i1 + 2); j1 = Math.min(H - 1, j1 + 2);
    const nx = i1 - i0 + 1, ny = j1 - j0 + 1, nv = nx * ny;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), lav = new Float32Array(nv * 2);
    const hh = (i, j) => { i = Math.max(0, Math.min(W - 1, i)); j = Math.max(0, Math.min(H - 1, j)); const v = heights[j * W + i]; return isFinite(v) ? Math.max(0, v) : 0; };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = (j - j0) * nx + (i - i0), c = j * W + i, [mx, my] = cellCenter(c);
      pos[v * 3] = (mx - CXM) * COSLAT; pos[v * 3 + 1] = (my - CYM) * COSLAT; pos[v * 3 + 2] = hh(i, j);
      const gx = (hh(i + 1, j) - hh(i - 1, j)) / (2 * GRID.cell), gy = (hh(i, j - 1) - hh(i, j + 1)) / (2 * GRID.cell), L = Math.hypot(gx, gy, 1);
      nrm[v * 3] = -gx / L; nrm[v * 3 + 1] = -gy / L; nrm[v * 3 + 2] = 1 / L;
      let a = arr[c];
      if (!isFinite(a)) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < W && jj < H && arr[jj * W + ii] < a) a = arr[jj * W + ii]; }
      lav[v * 2] = isFinite(a) ? a : 1e6; lav[v * 2 + 1] = mask[c];
    }
    const idx = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (lav[a * 2 + 1] + lav[b * 2 + 1] + lav[c * 2 + 1] + lav[d * 2 + 1] > 0) idx.push(a, c, b, b, c, d); }
    const arrivals = []; for (let c = 0; c < n; c++) if (mask[c]) arrivals.push(arr[c]); arrivals.sort((p, q) => p - q);
    console.info("Vesuvius lava:", arrivals.length, "squares, speed", Math.round(speed), "m/h, reaches San Sebastiano:", isFinite(townDist));
    return { pos, nrm, lav, idx: new Uint32Array(idx), arrivals, ver: (lavaSurf ? lavaSurf.ver : 0) + 1 };
  }

  // ---------- Terrain from the scene's own elevation ----------
  async function loadTerrain() {
    await map.ground.load();
    const ext = new Extent({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 3857 } });
    const elevLayer = map.ground.layers.getItemAt(0);
    let sampler;
    try { sampler = await elevLayer.createElevationSampler(ext, { demResolution: GRID.cell }); }
    catch (e) { sampler = await map.ground.createElevationSampler(ext); }
    const geographic = sampler.spatialReference && (sampler.spatialReference.isGeographic || sampler.spatialReference.wkid === 4326), nd = sampler.noDataValue;
    const h = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      if (disposed) return null;
      const y = ymax - (j + 0.5) * cellM;
      for (let i = 0; i < W; i++) { const x = xmin + (i + 0.5) * cellM; let z;
        if (geographic) { const [lon, lat] = fromMerc(x, y); z = sampler.elevationAt(lon, lat); } else z = sampler.elevationAt(x, y);
        h[j * W + i] = (z === nd || z == null || !isFinite(z)) ? NaN : z; }
      if (j % 60 === 0) { $("eProg").style.width = Math.round(j / H * 80) + "%"; await new Promise((r) => setTimeout(r)); }
    }
    return h;
  }

  // ---------- Playback controls ----------
  async function begin() {
    if (busy || !lavaSurf) return;
    pb.active = true; clearParticles(); pb.sec = 0; pb.phase = -1; setPlaying(true);
  }
  const node = new EruptionNode({ view });
  $("ePlay").onclick = () => { if (busy) return; if (snd.on) initSound(); if (!pb.active || pb.sec >= PLAY_S) begin(); else setPlaying(!pb.playing); };
  $("eRestart").onclick = () => { if (!busy) { if (snd.on) initSound(); begin(); } };
  $("eScrub").oninput = () => { if (!pb.active) return; pb.scrubbing = true; pb.sec = $("eScrub").value / 1000 * PLAY_S; clearParticles(); node.requestRender(); };
  $("eScrub").onchange = () => { pb.scrubbing = false; };
  $("eCloud").onchange = () => { opts.cloud = $("eCloud").checked; node.requestRender(); };
  $("eGround").onchange = () => { opts.ground = $("eGround").checked; ashOpacity = { E: -1, W: -1 }; node.requestRender(); };
  $("eSound").onchange = () => setSound($("eSound").checked);

  // ---------- Go: fly there, load terrain, run the model for both flows ----------
  view.goTo({ position: { longitude: 14.335, latitude: 40.905, z: 5200 }, heading: 140, tilt: 62 }).catch(() => {});
  (async () => {
    try {
      heights = await loadTerrain(); if (disposed || !heights) return;
      findCraterTop(); buildAshGround();
      $("ePhase").textContent = "Working out where the lava flows…";
      const flows = [];
      for (const f of FLOWS) {
        const runner = LavaModel.createRunner({ h: heights, w: W, ht: H, cellTrue: GRID.cell, vent: idxOf(f.lon, f.lat), runs: 0, dh: 0,
          maxLen: 10000, stopElev: f.stop, width: 0, seed: 1944, maxPond: 30000 });
        flows.push({ ...f, res: runner.result() });
        $("eProg").style.width = (80 + 10 * flows.length) + "%"; await new Promise((r) => setTimeout(r));
      }
      lavaSurf = buildLavaSurface(flows);
      $("eProg").parentElement.hidden = true;
      busy = false;
      for (const id of ["ePlay", "eRestart", "eScrub"]) $(id).disabled = false;
      $("ePhase").innerHTML = PHASE_TEXT[0];
    } catch (e) {
      console.error(e); $("ePhase").textContent = "Couldn't load the elevation data. Check your connection and try again.";
    }
  })();

  return {
    dispose() {
      disposed = true; pb.active = false; pb.playing = false;
      try { node.destroy(); } catch (e) {}
      map.removeMany([ashLayers.E, ashLayers.W, placeLayer]);
      if (snd.ctx) { try { snd.ctx.close(); } catch (e) {} }
      view.environment && view.requestRender?.();
    }
  };
}
