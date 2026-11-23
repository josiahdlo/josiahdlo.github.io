// Lam-Q quartz manipulation robot: real-time pick-and-place animation built from the team's STEP model.
// Bodies (base > column > carriage > elbow > selector) come from lamq_bodies.glb; joint axes and tube
// centerlines come from lamq_rig.json. Every frame is computed from the timeline time, so the quartz
// can never drift out of sync with the arm.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

const INK = "#24272b";                    // line color, like a SolidWorks "shaded with edges" view
const INK_RGB = "0.141, 0.153, 0.169";

const root = document.querySelector("[data-lamq-viewer]");
if (root) init(root);

// CAD edges exported from the STEP file: per body, polyline lengths followed by Uint16-quantized points.
async function loadEdges(base) {
  const get = async (name, kind) => {
    const r = await fetch(base + name);
    if (!r.ok) throw new Error(name);
    return r[kind]();
  };
  const [info, buf] = await Promise.all([get("lamq_edges.json", "json"), get("lamq_edges.bin", "arrayBuffer")]);
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
  const [rig, gltf, cadEdges] = await Promise.all([
    fetch(base + "lamq_rig.json").then((r) => r.json()),
    new GLTFLoader().loadAsync(base + "lamq_bodies.glb"),
    loadEdges(base).catch(() => null),                     // the model still runs without its outlines
  ]);

  const MAT = {
    light: new THREE.MeshStandardMaterial({ color: "#dcdee1", metalness: 0.05, roughness: 0.62 }),
    alu: new THREE.MeshStandardMaterial({ color: "#e0e2e5", metalness: 0.12, roughness: 0.58 }),
    steel: new THREE.MeshStandardMaterial({ color: "#b9bdc2", metalness: 0.35, roughness: 0.45 }),
    motor: new THREE.MeshStandardMaterial({ color: "#575b62", metalness: 0.45, roughness: 0.45 }),
    dark: new THREE.MeshStandardMaterial({ color: "#2c2826", metalness: 0.15, roughness: 0.6 }),
    cup: new THREE.MeshStandardMaterial({ color: "#efefef", metalness: 0.0, roughness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({ color: "#cfe7f2", metalness: 0, roughness: 0.06, transparent: true, opacity: 0.55, clearcoat: 1 }),
    tube: new THREE.MeshStandardMaterial({ color: "#e4ebef", metalness: 0, roughness: 0.35, transparent: true, opacity: 0.88 }),
  };
  // ---------- CAD-style line work ----------
  // Faces sit slightly behind their lines so the two never z-fight.
  Object.values(MAT).forEach((m) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const EDGE_MAT = new THREE.LineBasicMaterial({ color: INK, toneMapped: false });   // true edges from the STEP file
  const OUTLINE_MAT = new THREE.ShaderMaterial({                                     // silhouettes of round parts
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
  // the clear tubing can't use a back-face outline, so its rim is inked in the shader instead
  MAT.tube.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace("#include <dithering_fragment>", `#include <dithering_fragment>
      float rimInk = smoothstep(0.42, 0.62, 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))));
      gl_FragColor = vec4(mix(gl_FragColor.rgb, vec3(${INK_RGB}), rimInk), max(gl_FragColor.a, rimInk));`);
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
    if (mat !== "glass") m.add(new THREE.Mesh(geo, OUTLINE_MAT));
    m.castShadow = true;
    m.receiveShadow = mat !== "glass";
    meshes[body].push(m);
    world.add(m);
  });
  // the edge lines ride on their body exactly like its meshes
  if (cadEdges) {
    for (const [body, geo] of Object.entries(cadEdges)) {
      if (!meshes[body]) continue;
      const lines = new THREE.LineSegments(geo, EDGE_MAT);
      meshes[body].push(lines);
      world.add(lines);
    }
  }

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
  const SEL_2MM = THREE.MathUtils.degToRad(rig.selector_axis.angle_2mm_deg);   // measured: 2 mm cups in the working position
  const qp = new URLSearchParams(location.search);
  const num = (k, d) => (qp.has(k) ? parseFloat(qp.get(k)) : d);
  const B = { th1: THREE.MathUtils.degToRad(num("th1", -25)), th2: THREE.MathUtils.degToRad(num("th2", -30)) };
  // key poses: [time s, th1, dy, th2, sel]
  const K = [
    [0.0, 0, UP, 0, 0],                // 4 mm cups down, hovering over the quartz
    [0.8, 0, UP, 0, 0],
    [1.8, 0, 0, 0, 0],                 // lower onto the quartz
    [2.4, 0, 0, 0, 0],                 // vacuum on
    [3.4, 0, UP, 0, 0],                // lift
    [6.0, B.th1, UP, B.th2, 0],        // swing to spot B
    [7.0, B.th1, 0, B.th2, 0],         // lower
    [7.6, B.th1, 0, B.th2, 0],         // release
    [8.6, B.th1, UP, B.th2, 0],        // lift
    [9.0, B.th1, UP, B.th2, 0],
    [10.3, B.th1, UP, B.th2, SEL_2MM], // switch to the 2 mm cups
    [11.0, B.th1, UP, B.th2, SEL_2MM],
    [12.3, B.th1, UP, B.th2, 0],       // back to the 4 mm cups
    [12.7, B.th1, UP, B.th2, 0],
    [13.7, B.th1, 0, B.th2, 0],        // lower again
    [14.3, B.th1, 0, B.th2, 0],        // vacuum on
    [15.3, B.th1, UP, B.th2, 0],       // lift
    [17.9, 0, UP, 0, 0],               // swing back to spot A
    [18.9, 0, 0, 0, 0],                // lower
    [19.5, 0, 0, 0, 0],                // release
    [20.5, 0, UP, 0, 0],               // lift, ready to loop
  ];
  const LOOP = K[K.length - 1][0];
  const CARRY = [[2.1, 7.3], [14.0, 19.2]];
  const LABELS = [
    [0.8, "Ready over the quartz"], [1.8, "Lowering the 4 mm cups"], [2.4, "Vacuum on, picking it up"],
    [6.0, "Moving the part"], [7.0, "Setting it down"], [9.0, "Releasing"],
    [11.0, "Switching to the 2 mm cups"], [12.7, "Switching back to the 4 mm cups"], [13.7, "Lowering again"],
    [14.3, "Vacuum on, picking it up"], [17.9, "Returning the part"], [18.9, "Setting it down"], [LOOP, "Releasing"],
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
  applyPose(7.3);
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
