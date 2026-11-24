// 6-axis surgical robot arm: simulated cutting path, built from the SolidWorks assembly.
// Bodies come from sra_bodies.glb. Joint axes (from the assembly mates) and the pre-solved joint
// angles for every frame come from sra_rig.json, so the blade tip stays on the path.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

const INK = "#17191c";
const INK_RGB = "0.090, 0.098, 0.110";
const ACCENT = "#18a058";

const root = document.querySelector("[data-sra-viewer]");
if (root) init(root);

// CAD edges from the STEP file: per body, polyline lengths followed by Uint16-quantized points.
async function loadEdges(base) {
  const get = async (name, kind) => {
    const r = await fetch(base + name);
    if (!r.ok) throw new Error(name);
    return r[kind]();
  };
  const [info, buf] = await Promise.all([get("sra_edges.json", "json"), get("sra_edges.bin", "arrayBuffer")]);
  const out = {};
  for (const [body, e] of Object.entries(info.bodies)) {
    const counts = new Uint16Array(buf, e.offset, e.nLines);
    const q = new Uint16Array(buf, e.offset + e.nLines * 2, e.nPoints * 3);
    const pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) pos[i] = info.origin[i % 3] + q[i] * info.scale;
    const index = new Uint32Array((e.nPoints - e.nLines) * 2);
    let start = 0, w = 0;
    for (const n of counts) {
      for (let k = 0; k < n - 1; k++) { index[w++] = start + k; index[w++] = start + k + 1; }
      start += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    out[body] = geo;
  }
  return out;
}

// A flat strip lying on the pad along the path; dashed when dash = [on, off] segment counts.
function ribbon(points, width, lift, dash) {
  const n = points.length;
  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[2] - a[2];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const p = points[i];
    pos.set([p[0] - tz * width / 2, p[1] + lift, p[2] + tx * width / 2, p[0] + tz * width / 2, p[1] + lift, p[2] - tx * width / 2], i * 6);
  }
  const index = [];
  for (let i = 0; i < n - 1; i++) {
    if (dash && i % (dash[0] + dash[1]) >= dash[0]) continue;
    const v = i * 2;
    index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  return geo;
}

async function init(root) {
  const stage = root.querySelector(".viewer__stage");
  const statusEl = root.querySelector(".viewer__status");
  const playBtn = root.querySelector(".viewer__play");
  const base = root.dataset.models;
  const qp = new URLSearchParams(location.search);
  const freezeT = qp.get("sra_t");

  // ---------- renderer / scene ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    root.classList.add("viewer--fallback");
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eef0ec");
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.maxPolarAngle = Math.PI * 0.49;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xa9ada5, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(0.7, 1.7, 0.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.1, far: 4 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- load ----------
  const [rig, gltf, cadEdges] = await Promise.all([
    fetch(base + "sra_rig.json").then((r) => r.json()),
    new GLTFLoader().loadAsync(base + "sra_bodies.glb"),
    loadEdges(base).catch(() => null),                     // the model still runs without its outlines
  ]);

  const MAT = {
    shell: new THREE.MeshStandardMaterial({ color: "#a2aabf", metalness: 0.08, roughness: 0.58 }),
    ring: new THREE.MeshStandardMaterial({ color: "#e4e6e9", metalness: 0.05, roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: "#44474d", metalness: 0.08, roughness: 0.62 }),
    panel: new THREE.MeshStandardMaterial({ color: "#d6d8db", metalness: 0.05, roughness: 0.62 }),
    servo: new THREE.MeshStandardMaterial({ color: "#55585f", metalness: 0.25, roughness: 0.5 }),
    mount: new THREE.MeshStandardMaterial({ color: "#c8cbd0", metalness: 0.08, roughness: 0.58 }),
    knife: new THREE.MeshStandardMaterial({ color: "#3a3d42", metalness: 0.3, roughness: 0.45 }),
  };
  // Faces sit slightly behind their lines so the two never z-fight.
  Object.values(MAT).forEach((m) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const EDGE_MAT = new THREE.LineBasicMaterial({ color: INK, toneMapped: false });
  const OUTLINE_MAT = new THREE.ShaderMaterial({           // silhouettes of round parts
    side: THREE.BackSide,
    toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    uniforms: { res: { value: new THREE.Vector2(1, 1) }, width: { value: 1 } },
    vertexShader: `uniform vec2 res; uniform float width;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec2 dir = (projectionMatrix * vec4(normalMatrix * normal, 0.0)).xy * res;
        float len = length(dir);
        if (len > 1e-5) clip.xy += (dir / len) * width * 2.0 / res * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: `void main() { gl_FragColor = vec4(${INK_RGB}, 1.0); }`,
  });

  // world group: floor at y = 0, base rotation axis at the origin
  const j1 = rig.axes[0].point;
  const world = new THREE.Group();
  world.position.set(-j1[0], -rig.ground_y, -j1[2]);
  scene.add(world);

  // every body keeps its as-assembled coordinates; its group holds the accumulated joint transform
  const links = {};
  rig.bodies.forEach((b) => {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    links[b] = g;
    world.add(g);
  });
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const [body, mat] = (o.name || o.parent.name).split("__");
    if (!links[body] || !MAT[mat]) return;
    const geo = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(35));
    const m = new THREE.Mesh(geo, MAT[mat]);
    m.add(new THREE.Mesh(geo, OUTLINE_MAT));
    m.castShadow = true;
    m.receiveShadow = true;
    links[body].add(m);
  });
  if (cadEdges) {
    for (const [body, geo] of Object.entries(cadEdges)) {
      if (links[body]) links[body].add(new THREE.LineSegments(geo, EDGE_MAT));
    }
  }

  // ---------- practice pad and path ----------
  const motion = rig.motion;
  const padInfo = motion.pad;
  const padGeo = new THREE.BoxGeometry(...padInfo.size);
  const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({
    color: "#f4efe7", roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  }));
  pad.position.set(...padInfo.center);
  pad.rotation.y = Math.atan2(padInfo.front[0], padInfo.front[2]);
  pad.castShadow = true;
  pad.receiveShadow = true;
  pad.add(new THREE.LineSegments(new THREE.EdgesGeometry(padGeo), EDGE_MAT));
  world.add(pad);

  const planned = new THREE.Mesh(ribbon(motion.path, 0.0012, 0.0003, [5, 4]),
    new THREE.MeshBasicMaterial({ color: "#8d9297", toneMapped: false, side: THREE.DoubleSide }));
  const cutMat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, transparent: true, side: THREE.DoubleSide });
  const cutGeo = ribbon(motion.path, 0.0024, 0.0005);
  const cutLine = new THREE.Mesh(cutGeo, cutMat);
  const cutCount = cutGeo.index.count;
  world.add(planned, cutLine);

  // ---------- timeline ----------
  const FPS = motion.fps, N = motion.q.length, LOOP = N / FPS, mk = motion.marks;
  const axes = rig.axes.map((a) => ({ p: new THREE.Vector3(...a.point), d: new THREE.Vector3(...a.dir).normalize() }));
  const LABELS = [
    [0.8, "Ready"], [mk.approach / FPS, "Moving to the start of the path"], [mk.contact / FPS, "Lowering the blade"],
    [mk.cut_end / FPS, "Following the cutting path"], [mk.lift_end / FPS, "Lifting clear"], [LOOP, "Returning home"],
  ];
  const acc = new THREE.Matrix4(), Rm = new THREE.Matrix4(), Ta = new THREE.Matrix4(), Tb = new THREE.Matrix4();

  function applyPose(t) {
    const f = Math.min(N - 1, ((t % LOOP) + LOOP) % LOOP * FPS);
    const i = Math.floor(f), j = Math.min(N - 1, i + 1), u = f - i;
    acc.identity();
    axes.forEach((a, k) => {
      Rm.makeRotationAxis(a.d, motion.q[i][k] * (1 - u) + motion.q[j][k] * u);
      Ta.makeTranslation(a.p.x, a.p.y, a.p.z);
      Tb.makeTranslation(-a.p.x, -a.p.y, -a.p.z);
      acc.multiply(Ta).multiply(Rm).multiply(Tb);
      const g = links[rig.bodies[k + 1]];
      g.matrix.copy(acc);
      g.matrixWorldNeedsUpdate = true;
    });
    const progress = motion.cut[i] * (1 - u) + motion.cut[j] * u;
    cutGeo.setDrawRange(0, Math.floor(progress * cutCount / 6) * 6);
    const fade = Math.min(1, Math.max(0, (t - (LOOP - 0.7)) / 0.6));
    cutMat.opacity = 1 - fade * fade * (3 - 2 * fade);
  }

  let lastLabel = "";
  function setLabel(t) {
    const l = (LABELS.find(([end]) => t < end) || LABELS[LABELS.length - 1])[1];
    if (l !== lastLabel) { statusEl.textContent = l; lastLabel = l; }
  }

  // ---------- camera framing ----------
  const v3 = (k, d) => (qp.has(k) ? qp.get(k).split(",").map(Number) : d);
  controls.target.set(...v3("tgt", [0.15, 0.125, -0.15]));
  camera.position.set(...v3("cam", [0.80, 0.74, 0.58]));
  controls.update();

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    OUTLINE_MAT.uniforms.res.value.set(w * pr, h * pr);
    OUTLINE_MAT.uniforms.width.value = 0.8 * pr;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- loop ----------
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let playing = !reduce && freezeT === null;
  let t = freezeT !== null ? parseFloat(freezeT) : reduce ? (mk.contact + mk.cut_end) / 2 / FPS : 0;
  let visible = true, last = performance.now();
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 }).observe(stage);

  function setPlaying(p) {
    playing = p;
    playBtn.setAttribute("aria-pressed", String(!p));
    playBtn.querySelector("span").textContent = p ? "Pause" : "Play";
    playBtn.dataset.state = p ? "playing" : "paused";
  }
  playBtn.addEventListener("click", () => setPlaying(!playing));
  setPlaying(playing);

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing && visible && !document.hidden) t = (t + dt) % LOOP;
    if (visible) {
      applyPose(t);
      setLabel(t);
      controls.update();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  root.classList.add("viewer--ready");
  requestAnimationFrame(frame);
}
