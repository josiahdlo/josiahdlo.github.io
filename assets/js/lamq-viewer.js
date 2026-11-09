// Lam-Q quartz manipulation robot: real-time pick-and-place animation built from the team's STEP model.
// Bodies (base > column > carriage > elbow > selector) come from lamq_bodies.glb; joint axes and tube
// centerlines come from lamq_rig.json. Every frame is computed from the timeline time, so the quartz
// can never drift out of sync with the arm.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

const root = document.querySelector("[data-lamq-viewer]");
if (root) init(root);

async function init(root) {
  const stage = root.querySelector(".viewer__stage");
  const statusEl = root.querySelector(".viewer__status");
  const playBtn = root.querySelector(".viewer__play");
  const base = root.dataset.models;
  const freezeT = new URLSearchParams(location.search).get("lamq_t");

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
  renderer.toneMappingExposure = 0.82;
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
  controls.minDistance = 0.45;
  controls.maxDistance = 3.0;
  controls.maxPolarAngle = Math.PI * 0.49;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xa9ada5, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(0.9, 1.6, 0.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -0.7, right: 0.7, top: 0.7, bottom: -0.7, near: 0.1, far: 4 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- load ----------
  const [rig, gltf] = await Promise.all([
    fetch(base + "lamq_rig.json").then((r) => r.json()),
    new GLTFLoader().loadAsync(base + "lamq_bodies.glb"),
  ]);

  const MAT = {
    light: new THREE.MeshStandardMaterial({ color: "#c9ccd1", metalness: 0.1, roughness: 0.55 }),
    alu: new THREE.MeshStandardMaterial({ color: "#c3c8ce", metalness: 0.55, roughness: 0.38 }),
    steel: new THREE.MeshStandardMaterial({ color: "#9aa0a7", metalness: 0.8, roughness: 0.32 }),
    motor: new THREE.MeshStandardMaterial({ color: "#575b62", metalness: 0.45, roughness: 0.45 }),
    dark: new THREE.MeshStandardMaterial({ color: "#2c2826", metalness: 0.15, roughness: 0.6 }),
    cup: new THREE.MeshStandardMaterial({ color: "#efefef", metalness: 0.0, roughness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({ color: "#cfe7f2", metalness: 0, roughness: 0.06, transparent: true, opacity: 0.55, clearcoat: 1 }),
    tube: new THREE.MeshStandardMaterial({ color: "#e4ebef", metalness: 0, roughness: 0.35, transparent: true, opacity: 0.88 }),
  };

  // world group: puts the floor at y = 0 and the column axis at the origin
  const colX = rig.column_axis.x, colZ = rig.column_axis.z;
  const world = new THREE.Group();
  world.position.set(-colX, -rig.ground_y, -colZ);
  scene.add(world);

  const meshes = { base: [], column: [], carriage: [], elbow: [], selector: [], quartz: [] };
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const [body, mat] = (o.name || o.parent.name).split("__");
    if (!meshes[body] || !MAT[mat]) return;
    const geo = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(35));
    const m = new THREE.Mesh(geo, MAT[mat]);
    m.castShadow = true;
    m.receiveShadow = mat !== "glass";
    meshes[body].push(m);
    world.add(m);
  });

  // ---------- rig ----------
  const colPivot = new THREE.Group();
  colPivot.position.set(colX, 0, colZ);
  world.add(colPivot);
  const carriage = new THREE.Group();
  colPivot.add(carriage);
  const elbowPivot = new THREE.Group();
  elbowPivot.position.set(rig.elbow_axis.x - colX, 0, rig.elbow_axis.z - colZ);
  carriage.add(elbowPivot);
  const sp = rig.selector_axis.point;
  const selAxis = new THREE.Vector3(...rig.selector_axis.dir).normalize();
  const selPivot = new THREE.Group();
  selPivot.position.set(sp[0] - rig.elbow_axis.x, sp[1], sp[2] - rig.elbow_axis.z);
  elbowPivot.add(selPivot);

  world.updateMatrixWorld(true);
  meshes.column.forEach((m) => colPivot.attach(m));
  meshes.carriage.forEach((m) => carriage.attach(m));
  meshes.elbow.forEach((m) => elbowPivot.attach(m));
  meshes.selector.forEach((m) => selPivot.attach(m));

  // quartz: positioned every frame from the timeline (matrix set by hand)
  const quartz = new THREE.Group();
  world.add(quartz);
  meshes.quartz.forEach((m) => { world.remove(m); quartz.add(m); });
  quartz.matrixAutoUpdate = false;
  quartz.updateMatrix();
  const quartzRest = quartz.matrix.clone();                // lying at spot A (as modelled)
  scene.updateMatrixWorld(true);
  const worldInv = new THREE.Matrix4().copy(world.matrixWorld).invert();
  // quartz relative to the selector at the moment of pickup (rest pose = cups on the quartz)
  const quartzInSel = new THREE.Matrix4().copy(selPivot.matrixWorld).invert().multiply(world.matrixWorld).multiply(quartzRest);

  // ---------- tubes (rebuilt each frame through points carried by the bodies) ----------
  const bodyObj = { base: world, column: colPivot, carriage, elbow: elbowPivot, selector: selPivot };
  const tubes = Object.entries(rig.tubes).map(([key, t]) => {
    const anchors = t.points.map((p) => {
      const obj = bodyObj[p.body] || world;
      const wp = world.localToWorld(new THREE.Vector3(...p.p));
      return { obj, local: obj.worldToLocal(wp.clone()) };
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), MAT.tube);
    mesh.castShadow = true;
    world.add(mesh);
    return { key, anchors, mesh, radius: t.radius, segs: key === "main" ? 220 : 48 };
  });
  const tmp = new THREE.Vector3();
  function updateTubes() {
    scene.updateMatrixWorld(true);
    worldInv.copy(world.matrixWorld).invert();
    for (const t of tubes) {
      const pts = t.anchors.map((a) => a.obj.localToWorld(tmp.copy(a.local)).applyMatrix4(worldInv).clone());
      const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      t.mesh.geometry.dispose();
      t.mesh.geometry = new THREE.TubeGeometry(curve, t.segs, t.radius, 10, false);
    }
  }

  // ---------- timeline ----------
  const UP = 0.085;                                        // carriage lift (m)
  const SEL_SMALL = THREE.MathUtils.degToRad(-120);        // a smaller cup cluster pointing down
  const qp = new URLSearchParams(location.search);
  const num = (k, d) => (qp.has(k) ? parseFloat(qp.get(k)) : d);
  const B = { th1: THREE.MathUtils.degToRad(num("th1", -25)), th2: THREE.MathUtils.degToRad(num("th2", -30)) };
  // key poses: [time s, th1, dy, th2, sel]
  const K = [
    [0.0, 0, UP, 0, SEL_SMALL],
    [1.0, 0, UP, 0, SEL_SMALL],
    [2.3, 0, UP, 0, 0],          // select the 4 mm cups for the large part
    [3.3, 0, 0, 0, 0],           // lower onto the quartz
    [3.9, 0, 0, 0, 0],           // vacuum on
    [4.9, 0, UP, 0, 0],          // lift
    [7.5, B.th1, UP, B.th2, 0],  // swing to spot B
    [8.5, B.th1, 0, B.th2, 0],   // lower
    [9.1, B.th1, 0, B.th2, 0],   // release
    [10.1, B.th1, UP, B.th2, 0], // lift
    [10.7, B.th1, UP, B.th2, 0],
    [11.7, B.th1, 0, B.th2, 0],  // lower again
    [12.3, B.th1, 0, B.th2, 0],  // vacuum on
    [13.3, B.th1, UP, B.th2, 0], // lift
    [15.9, 0, UP, 0, 0],         // swing back to spot A
    [16.9, 0, 0, 0, 0],          // lower
    [17.5, 0, 0, 0, 0],          // release
    [18.5, 0, UP, 0, 0],         // lift
    [19.8, 0, UP, 0, SEL_SMALL], // back to the small cups
  ];
  const LOOP = K[K.length - 1][0];
  const CARRY = [[3.6, 8.8], [12.0, 17.2]];
  const LABELS = [
    [1.0, "Ready over the quartz"], [2.3, "Selecting the 4 mm cups"], [3.3, "Lowering onto the quartz"],
    [3.9, "Vacuum on, picking it up"], [7.5, "Moving the part"], [8.5, "Setting it down"], [10.1, "Releasing"],
    [11.7, "Lowering again"], [12.3, "Vacuum on, picking it up"], [15.9, "Returning the part"], [16.9, "Setting it down"],
    [18.5, "Releasing"], [LOOP, "Switching back to smaller cups"],
  ];
  const ease = (x) => x * x * (3 - 2 * x);
  function pose(t) {
    let i = 0;
    while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const a = K[i], b = K[i + 1];
    const u = ease(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
    return [1, 2, 3, 4].map((j) => a[j] + (b[j] - a[j]) * u);
  }
  function applyPose(t) {
    const [th1, dy, th2, sel] = pose(t);
    colPivot.rotation.y = th1;
    carriage.position.y = dy;
    elbowPivot.rotation.y = th2;
    selPivot.quaternion.setFromAxisAngle(selAxis, sel);
  }

  // quartz pose when resting at spot B = selector pose at the release moment x relative transform
  applyPose(8.6);
  scene.updateMatrixWorld(true);
  worldInv.copy(world.matrixWorld).invert();
  const quartzAtB = new THREE.Matrix4().copy(worldInv).multiply(selPivot.matrixWorld).multiply(quartzInSel);

  function placeQuartz(t) {
    const carried = CARRY.some(([s, e]) => t >= s && t < e);
    if (carried) {
      scene.updateMatrixWorld(true);
      worldInv.copy(world.matrixWorld).invert();
      quartz.matrix.copy(worldInv).multiply(selPivot.matrixWorld).multiply(quartzInSel);
    } else {
      const atB = t >= CARRY[0][1] && t < CARRY[1][0];
      quartz.matrix.copy(atB ? quartzAtB : quartzRest);
    }
    quartz.matrixWorldNeedsUpdate = true;
  }

  let lastLabel = "";
  function setLabel(t) {
    const l = (LABELS.find(([end]) => t < end) || LABELS[LABELS.length - 1])[1];
    if (l !== lastLabel) { statusEl.textContent = l; lastLabel = l; }
  }

  // ---------- camera framing ----------
  const v3 = (k, d) => (qp.has(k) ? qp.get(k).split(",").map(Number) : d);
  controls.target.set(...v3("tgt", [0.02, 0.22, -0.17]));
  camera.position.set(...v3("cam", [0.452, 0.814, -1.475]));
  controls.update();

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---------- loop ----------
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let playing = !reduce && freezeT === null;
  let t = freezeT !== null ? parseFloat(freezeT) : reduce ? 6.2 : 0;
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
      placeQuartz(t);
      updateTubes();
      setLabel(t);
      controls.update();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  root.classList.add("viewer--ready");
  requestAnimationFrame(frame);
}
