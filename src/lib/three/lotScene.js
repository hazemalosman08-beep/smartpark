// The 3D lot for the driver guide, built with plain Three.js.
//
// Everything placed here comes from SmartPark's own data: spaces and the
// entrance from the lot map, islands/kerbs, trees and building footprints from
// the camera picture (sceneFeatures) or drawn by hand, cars from the occupancy
// and the camera tracker. Nothing is added for decoration. One lot unit is
// lot.metersPerUnit metres; 3D units are metres (x = east, z = south, y = up).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pointAlong } from "@/lib/vision/navigation";

export const THEMES = {
  dark: {
    bg: 0x0a0f14, ground: 0x141b22, line: 0xe2e8f0, lineOpacity: 0.7,
    building: 0x3b4756, roof: 0x4a5767, buildingEdge: 0x93a4b8, island: 0x1d4a33, curb: 0x5c6670,
    trunk: 0x4b3a2a, canopy: 0x2c6a45,
    free: 0x22c55e, taken: 0xef4444, reserved: 0x3b82f6, unknown: 0x64748b, accessible: 0x3b82f6,
    route: 0x3b82f6, routeGlow: 0x60a5fa, target: 0x4ade80, ghost: 0x60a5fa,
    walk: "#fbbf24",
    sky: 0xbfd4ff, skyGround: 0x1a1f24, hemi: 0.95, sun: 1.15,
    labelBg: "rgba(15,23,42,0.92)", labelFg: "#e2e8f0",
  },
  light: {
    bg: 0xe8edf2, ground: 0xd3d9df, line: 0xffffff, lineOpacity: 0.95,
    building: 0xeef1f4, roof: 0xdfe4ea, buildingEdge: 0x8b97a5, island: 0x9fd39a, curb: 0xcbd1d7,
    trunk: 0x8a6b4a, canopy: 0x5fae6a,
    free: 0x16a34a, taken: 0xdc2626, reserved: 0x2563eb, unknown: 0x94a3b8, accessible: 0x2563eb,
    route: 0x2563eb, routeGlow: 0x3b82f6, target: 0x16a34a, ghost: 0x2563eb,
    walk: "#d97706",
    sky: 0xffffff, skyGround: 0x9aa3ad, hemi: 1.0, sun: 1.0,
    labelBg: "rgba(255,255,255,0.95)", labelFg: "#0f172a",
  },
};

const BUILDING_HEIGHT = 9; // m: three storeys; the picture gives no heights
const CURB_HEIGHT = 0.15; // m
const CAR = { length: 4.6, width: 1.85 };
const MAX_CARS = 400;
const LABEL = 0.036; // label height, share of the screen height

export class LotScene {
  /**
   * canvas: the lot's own screen. Or { embedded: renderer }: the lot is drawn
   * inside another 3D map (the campus map): this.scene is then a group that
   * map places on the lot, and frame() only animates (no camera, no render).
   */
  constructor(canvas, { onProgress = null, embedded = null } = {}) {
    this.canvas = canvas;
    this.onProgress = onProgress;
    this.embedded = Boolean(embedded);
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    if (embedded) {
      this.renderer = embedded;
      this.scene = new THREE.Group();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
      this.controls = { enabled: false, target: new THREE.Vector3(), update() {}, dispose() {} };
    } else {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !small || window.devicePixelRatio < 2, alpha: false, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.maxPolarAngle = Math.PI * 0.47;
      this.controls.enabled = false;
    }
    this.theme = THEMES.dark;
    this.themeName = "dark";
    this.mode = "bird";
    this.groups = {};
    for (const name of ["static", "stalls", "cars", "route", "walk", "marker", "labels"]) {
      this.groups[name] = new THREE.Group();
      this.scene.add(this.groups[name]);
    }
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.position.set(-0.6, 1, 0.4);
    if (!this.embedded) this.scene.add(this.hemi, this.sun); // embedded: the host map's light
    this.cars = new Map(); // key -> { x, z, h, tx, tz, th, color, seen }
    this.carMeshes = null;
    this.data = { lot: null, features: null, sceneImage: null, rect: null, statuses: null, route: [], target: null, ego: null, previewing: false };
    this.cam = { pos: new THREE.Vector3(0, 80, 80), look: new THREE.Vector3() };
    this.ghost = { d: 0, pause: 0 };
    this.clock = new THREE.Clock();
    this.running = false;
    this.lastFrame = 0;
    this.textureLoader = new THREE.TextureLoader();
    this.m = 1;
    this.applyThemeLights();
  }

  // ------------------------------------------------------------ lifecycle
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      // About 40 frames a second is smooth for a lot; it spares phone batteries.
      if (t - this.lastFrame < 24) return;
      this.lastFrame = t;
      this.frame(Math.min(0.1, this.clock.getDelta()));
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  resize(w, h) {
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.stop();
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
    });
    this.groundTexture?.dispose();
    if (!this.embedded) this.renderer.dispose();
  }

  // --------------------------------------------------------------- inputs
  setTheme(name) {
    if (this.themeName === name) return;
    this.themeName = name;
    this.theme = THEMES[name] || THEMES.dark;
    this.applyThemeLights();
    this.buildStatic();
    this.buildStalls();
    this.buildRoute();
    this.buildWalk();
    this.buildMarker();
    this.rebuildCars();
  }

  setLot({ lot, features, sceneImages, rect }) {
    this.data.lot = lot;
    this.data.features = features;
    this.data.sceneImages = sceneImages;
    this.data.rect = rect;
    this.m = lot?.metersPerUnit > 0 ? lot.metersPerUnit : 1;
    this.buildStatic();
    this.buildStalls();
    this.rebuildCars();
    this.fitBird(true);
  }

  setStatuses(statuses) {
    this.data.statuses = statuses;
    this.colorStalls();
  }

  /** cars: [{ key, x, y, heading, color, you }] in lot units. */
  setCars(cars) {
    const seen = new Set();
    for (const c of cars) {
      seen.add(c.key);
      const prev = this.cars.get(c.key);
      const x = c.x * this.m, z = c.y * this.m, h = Number.isFinite(c.heading) ? c.heading : prev?.th ?? 0;
      if (prev) Object.assign(prev, { tx: x, tz: z, th: h, color: c.color, you: c.you });
      else this.cars.set(c.key, { x, z, h, tx: x, tz: z, th: h, color: c.color, you: c.you });
    }
    for (const key of [...this.cars.keys()]) if (!seen.has(key)) this.cars.delete(key);
  }

  /** route in lot units; target stall; ego: live driver pose or null (preview). */
  setRoute(route, target, { live = false } = {}) {
    const key = `${target?.id}|${route.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";")}`;
    this.data.live = live;
    if (key === this.routeKey) return;
    const newTarget = this.data.target?.id !== target?.id;
    this.routeKey = key;
    this.data.route = route;
    this.data.target = target;
    if (newTarget || !live) this.ghost = { d: 0, pause: 0 };
    this.buildRoute();
    this.buildMarker();
  }

  setEgo(pose) { this.data.ego = pose; }

  /** Walking route (lot units) from the parked space to the building. */
  setWalk(path) {
    const key = (path || []).map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(";");
    if (key === this.walkKey) return;
    this.walkKey = key;
    this.data.walk = path;
    this.buildWalk();
  }

  buildWalk() {
    this.clear("walk");
    this.walkTexture = null;
    const path = this.data.walk;
    if (!path || path.length < 2) return;
    const pts = roundCorners(path.map((p) => new THREE.Vector2(p.x * this.m, p.y * this.m)), 1.5);
    const tex = dotsTexture(this.theme.walk);
    this.walkTexture = tex;
    const mesh = new THREE.Mesh(ribbon(pts, 0.7, 0.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 8;
    this.groups.walk.add(mesh);
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === "free";
    if (mode === "free") {
      this.controls.target.copy(this.cam.look);
      this.controls.update();
    }
  }

  // ------------------------------------------------------------ builders
  W(p, y = 0) { return new THREE.Vector3(p.x * this.m, y, p.y * this.m); }

  clear(group) {
    const g = this.groups[group];
    for (const o of [...g.children]) {
      g.remove(o);
      o.traverse?.((c) => {
        c.geometry?.dispose?.();
        const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
        mats.forEach((mat) => { if (mat.map && mat.map !== this.groundTexture) mat.map.dispose(); mat.dispose(); });
      });
    }
  }

  applyThemeLights() {
    const t = this.theme;
    if (!this.embedded) {
      this.scene.background = new THREE.Color(t.bg);
      this.scene.fog = new THREE.Fog(t.bg, 250, 900);
    }
    this.hemi.color.set(t.sky);
    this.hemi.groundColor.set(t.skyGround);
    this.hemi.intensity = t.hemi;
    this.sun.intensity = t.sun;
  }

  buildStatic() {
    this.clear("static");
    this.clear("labels");
    const { lot, features, sceneImages, rect } = this.data;
    if (!lot) return;
    const t = this.theme, g = this.groups.static;
    // Ground: the lot's own surroundings drawn from the picture, on a plain base.
    const b = rect || lot.bounds;
    const cx = (b.x + b.w / 2) * this.m, cz = (b.y + b.h / 2) * this.m;
    if (!this.embedded) {
      const base = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: t.ground }));
      base.rotation.x = -Math.PI / 2;
      base.position.set(cx, -0.05, cz);
      g.add(base);
    }
    const url = sceneImages?.[this.themeName];
    if (url && rect) {
      if (this.groundUrl !== url) {
        this.groundTexture?.dispose();
        this.groundTexture = this.textureLoader.load(url);
        this.groundTexture.colorSpace = THREE.SRGBColorSpace;
        this.groundTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this.groundUrl = url;
      }
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(rect.w * this.m, rect.h * this.m), new THREE.MeshBasicMaterial({ map: this.groundTexture }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cx, 0, cz);
      g.add(plane);
    } else {
      // No picture: the mapped area as plain pavement.
      const lb = lot.bounds;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(lb.w * this.m, lb.h * this.m), new THREE.MeshBasicMaterial({ color: new THREE.Color(t.ground).offsetHSL(0, 0, this.themeName === "dark" ? 0.04 : 0.06) }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((lb.x + lb.w / 2) * this.m, 0, (lb.y + lb.h / 2) * this.m);
      g.add(plane);
    }

    // Painted lines: both sides and the back of every space.
    const lineW = 0.12;
    const quads = [];
    for (const s of lot.stalls) {
      const P = s.poly;
      for (const [a, c] of [[P[0], P[3]], [P[3], P[2]], [P[2], P[1]]]) quads.push(stripe(this.W(a, 0.03), this.W(c, 0.03), lineW));
    }
    if (quads.length) {
      const lines = new THREE.Mesh(mergeQuads(quads), new THREE.MeshBasicMaterial({ color: t.line, transparent: true, opacity: t.lineOpacity, depthWrite: false, side: THREE.DoubleSide }));
      lines.renderOrder = 2;
      g.add(lines);
    }

    // Islands and kerbs (raised planted areas seen in the picture).
    if (features?.islands?.length) {
      const mats = [new THREE.MeshLambertMaterial({ color: t.island }), new THREE.MeshLambertMaterial({ color: t.curb })];
      for (const poly of features.islands) {
        const geo = extrude(poly, CURB_HEIGHT, this.m);
        if (geo) g.add(new THREE.Mesh(geo, mats));
      }
    }

    // Buildings: footprints found in the picture or drawn by hand. Height is
    // not in a photo: a standard three-storey block.
    // In a campus map the real buildings are already there.
    const footprints = this.embedded ? [] : [
      ...(features?.buildings || []),
      ...(lot.footprints || []).map((f) => ({ outer: f.points, holes: [] })),
    ];
    for (const poly of footprints) {
      const geo = extrude(poly, BUILDING_HEIGHT, this.m);
      if (!geo) continue;
      g.add(new THREE.Mesh(geo, [new THREE.MeshLambertMaterial({ color: t.roof }), new THREE.MeshLambertMaterial({ color: t.building })]));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: t.buildingEdge, transparent: true, opacity: 0.6 }));
      g.add(edges);
    }

    // Trees where the picture shows canopy.
    const trees = features?.trees || [];
    if (trees.length) {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 1, 6), new THREE.MeshLambertMaterial({ color: t.trunk }), trees.length);
      const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: t.canopy, flatShading: true }), trees.length);
      const mtx = new THREE.Matrix4();
      trees.forEach((tr, i) => {
        const r = Math.max(1.2, Math.min(5, tr.r * this.m));
        const h = 2 + r * 0.6;
        mtx.compose(new THREE.Vector3(tr.x * this.m, h / 2, tr.y * this.m), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
        trunk.setMatrixAt(i, mtx);
        mtx.compose(new THREE.Vector3(tr.x * this.m, h + r * 0.55, tr.y * this.m), new THREE.Quaternion(), new THREE.Vector3(r, r * 0.85, r));
        canopy.setMatrixAt(i, mtx);
      });
      g.add(trunk, canopy);
    }

    // Accessible / reserved marks painted in their spaces.
    for (const s of lot.stalls) {
      if (!s.kind) continue;
      const tag = makeLabel(s.kind === "accessible" ? "♿" : "R", { bg: s.kind === "accessible" ? "#2563eb" : "#7c3aed", fg: "#fff", round: true });
      const width = this.W(s.poly[0]).distanceTo(this.W(s.poly[1]));
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.6, width * 0.6), new THREE.MeshBasicMaterial({ map: tag.texture, transparent: true, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2;
      plane.rotation.z = -(s.heading + Math.PI / 2);
      plane.position.copy(this.W(s.centroid, 0.05));
      plane.renderOrder = 3;
      g.add(plane);
    }

    // A complex: one label per lot with how many spaces are free.
    for (const a of lot.areas || []) {
      const known = a.total - a.unknown;
      const text = known ? `${a.name}  ${a.open} free / ${a.total}` : `${a.name}  no camera reading`;
      const bg = !known ? "#475569" : a.open === 0 ? "#dc2626" : a.open / known < 0.1 ? "#ea580c" : a.open / known < 0.3 ? "#d97706" : "#16a34a";
      this.addPin({ x: a.x * (lot.calibration?.aspect || 1), y: a.y }, text, { bg, fg: "#fff", height: 6 });
    }

    // Entrance and buildings (destinations).
    if (lot.entrance) this.addPin(lot.entrance, "ENTRANCE", { bg: this.themeName === "dark" ? "#e2e8f0" : "#0f172a", fg: this.themeName === "dark" ? "#0f172a" : "#fff", height: 3 });
    for (const bld of this.embedded ? [] : lot.buildings || []) {
      const dest = this.data.destinationId ? bld.id === this.data.destinationId : bld === lot.buildings[0];
      this.addPin(bld, bld.name.toUpperCase(), { bg: dest ? "#f59e0b" : "#78716c", fg: dest ? "#1c1917" : "#fff", height: footprints.some((f) => inside(bld, f.outer)) ? BUILDING_HEIGHT + 3 : 4 });
    }
  }

  setDestination(id) {
    if (this.data.destinationId === id) return;
    this.data.destinationId = id;
    if (this.data.lot) this.buildStatic();
  }

  addPin(p, text, { bg, fg, height }) {
    const base = this.W(p);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, height, 6), new THREE.MeshBasicMaterial({ color: bg }));
    pole.position.set(base.x, height / 2, base.z);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshBasicMaterial({ color: bg, transparent: true, opacity: 0.85, depthWrite: false }));
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(base.x, 0.06, base.z);
    const label = makeLabel(text, { bg, fg });
    label.sprite.position.set(base.x, height + 0.9, base.z);
    label.sprite.scale.set(label.aspect * LABEL, LABEL, 1);
    this.groups.labels.add(pole, dot, label.sprite);
  }

  buildStalls() {
    this.clear("stalls");
    const { lot } = this.data;
    if (!lot?.stalls.length) return;
    const n = lot.stalls.length;
    const pos = new Float32Array(n * 4 * 3), col = new Float32Array(n * 4 * 3), idx = [];
    lot.stalls.forEach((s, i) => {
      const c = s.centroid;
      // Inset a little so the painted lines stay visible.
      s.poly.slice(0, 4).forEach((p, k) => {
        const q = { x: c.x + (p.x - c.x) * 0.9, y: c.y + (p.y - c.y) * 0.9 };
        pos.set([q.x * this.m, 0.02, q.y * this.m], (i * 4 + k) * 3);
      });
      idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    this.stallMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: this.themeName === "dark" ? 0.55 : 0.6, depthWrite: false, side: THREE.DoubleSide }));
    this.stallMesh.renderOrder = 1;
    this.groups.stalls.add(this.stallMesh);
    this.colorStalls();
  }

  colorStalls() {
    const { lot, statuses } = this.data;
    if (!this.stallMesh || !lot) return;
    const t = this.theme;
    const col = this.stallMesh.geometry.getAttribute("color");
    const c = new THREE.Color();
    lot.stalls.forEach((s, i) => {
      const st = statuses?.get?.(s.id);
      // Gray: not checked yet or changing right now (unverified).
      const tone = !st || st.changing || st.status === "unknown" ? t.unknown : st.status === "occupied" ? t.taken : s.kind === "reserved" ? t.reserved : t.free;
      c.set(tone);
      // Free spaces are a soft tint; taken ones stand out under their car.
      if (tone === t.free) c.lerp(new THREE.Color(t.ground), this.themeName === "dark" ? 0.45 : 0.35);
      for (let k = 0; k < 4; k += 1) col.setXYZ(i * 4 + k, c.r, c.g, c.b);
    });
    col.needsUpdate = true;
  }

  buildRoute() {
    this.clear("route");
    this.routeTexture = null;
    const { route } = this.data;
    if (!route || route.length < 2) { this.routePts = null; return; }
    const pts = roundCorners(route.map((p) => new THREE.Vector2(p.x * this.m, p.y * this.m)), 3.5);
    this.routePts = pts;
    const t = this.theme;
    const glow = new THREE.Mesh(ribbon(pts, 3.2, 0.04), new THREE.MeshBasicMaterial({ color: t.routeGlow, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    glow.renderOrder = 4;
    const tex = chevronTexture(`#${new THREE.Color(t.route).getHexString()}`);
    this.routeTexture = tex;
    const main = new THREE.Mesh(ribbon(pts, 1.6, 0.06), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    main.renderOrder = 5;
    this.groups.route.add(glow, main);
  }

  buildMarker() {
    this.clear("marker");
    this.marker = null;
    const { target } = this.data;
    if (!target) return;
    const t = this.theme;
    const g = new THREE.Group();
    // A glowing outline on the ground.
    const P = target.poly.map((p) => this.W(p, 0.08));
    const frame = new THREE.Mesh(mergeQuads([0, 1, 2, 3].map((i) => stripe(P[i], P[(i + 1) % 4], 0.3))), new THREE.MeshBasicMaterial({ color: t.target, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    frame.renderOrder = 6;
    const fill = new THREE.Mesh(quadGeo(P), new THREE.MeshBasicMaterial({ color: t.target, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    fill.renderOrder = 6;
    // A pin floating above the space, with its label.
    const c = this.W(target.centroid);
    const pin = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), new THREE.MeshLambertMaterial({ color: t.target, emissive: t.target, emissiveIntensity: 0.35 }));
    head.position.y = 1.05;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 24), new THREE.MeshLambertMaterial({ color: t.target, emissive: t.target, emissiveIntensity: 0.35 }));
    tip.rotation.x = Math.PI;
    tip.position.y = 0.45;
    const label = makeLabel(target.label, { bg: "#22c55e", fg: "#052e16", bold: true });
    label.sprite.position.y = 2.2;
    label.sprite.scale.set(label.aspect * LABEL * 1.25, LABEL * 1.25, 1);
    pin.add(head, tip, label.sprite);
    pin.position.set(c.x, 1.6, c.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: t.target, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, 0.1, c.z);
    ring.renderOrder = 7;
    g.add(frame, fill, pin, ring);
    this.groups.marker.add(g);
    this.marker = { pin, ring, frame };
  }

  rebuildCars() {
    this.clear("cars");
    const t = this.theme;
    const geos = carGeometries();
    const body = new THREE.InstancedMesh(geos.body, new THREE.MeshPhongMaterial({ shininess: 70, specular: 0x333333 }), MAX_CARS);
    const dark = new THREE.InstancedMesh(geos.dark, new THREE.MeshPhongMaterial({ color: 0x0b1220, shininess: 90, specular: 0x555555 }), MAX_CARS);
    const shadow = new THREE.InstancedMesh(new THREE.PlaneGeometry(CAR.length * 1.15, CAR.width * 1.35), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: this.themeName === "dark" ? 0.7 : 0.35 }), MAX_CARS);
    shadow.renderOrder = 3;
    for (const m of [body, dark, shadow]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3);
    this.groups.cars.add(shadow, body, dark);
    this.carMeshes = { body, dark, shadow };
    // The guided car (yours) or the route preview car, drawn on its own.
    const ghostMat = new THREE.MeshPhongMaterial({ color: t.ghost, transparent: true, opacity: 0.85, shininess: 80 });
    const ghost = new THREE.Group();
    ghost.add(new THREE.Mesh(geos.body, ghostMat), new THREE.Mesh(geos.dark, new THREE.MeshPhongMaterial({ color: 0x0b1220, transparent: true, opacity: 0.9 })));
    const halo = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.1, 48), new THREE.MeshBasicMaterial({ color: t.ghost, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.08;
    ghost.add(halo);
    ghost.visible = false;
    this.groups.cars.add(ghost);
    this.ghostCar = { group: ghost, halo };
  }

  // ------------------------------------------------------------- cameras
  lotBox() {
    const { lot, rect } = this.data;
    // A whole complex: frame the whole satellite picture.
    if (lot.campus && rect) return { minX: rect.x * this.m, maxX: (rect.x + rect.w) * this.m, minZ: rect.y * this.m, maxZ: (rect.y + rect.h) * this.m };
    const pts = lot.stalls.length ? lot.stalls.flatMap((s) => s.poly) : [{ x: lot.bounds.x, y: lot.bounds.y }, { x: lot.bounds.x + lot.bounds.w, y: lot.bounds.y + lot.bounds.h }];
    if (lot.entrance) pts.push(lot.entrance);
    const xs = pts.map((p) => p.x * this.m), zs = pts.map((p) => p.y * this.m);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }

  birdView() {
    const b = this.lotBox();
    const c = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    const span = Math.max(b.maxX - b.minX, (b.maxZ - b.minZ) * Math.max(1, this.camera.aspect * 0.8));
    const d = Math.max(30, span * 0.95);
    return { pos: new THREE.Vector3(c.x, d * 0.78, c.z + d * 0.62), look: c };
  }

  fitBird(snap = false) {
    if (!this.data.lot) return;
    const v = this.birdView();
    if (snap) { this.cam.pos.copy(v.pos); this.cam.look.copy(v.look); this.camera.position.copy(v.pos); this.camera.lookAt(v.look); }
    if (this.mode === "free") { this.controls.target.copy(v.look); this.camera.position.copy(v.pos); }
  }

  driverView(ego, remaining) {
    const dir = new THREE.Vector3(Math.cos(ego.heading), 0, Math.sin(ego.heading));
    const near = remaining < 25;
    // A tall phone screen needs the camera further back to show the road ahead.
    const k = this.camera.aspect < 1 ? 1.7 : 1;
    const back = (near ? 10 : 15) * k, up = (near ? 7 : 9.5) * k, ahead = near ? 6 : 14;
    const p = new THREE.Vector3(ego.x, 0, ego.z);
    return { pos: p.clone().addScaledVector(dir, -back).setY(up), look: p.clone().addScaledVector(dir, ahead) };
  }

  // ------------------------------------------------------------ per frame
  frame(dt) {
    const time = this.clock.elapsedTime;
    if (!this.data.lot) { if (!this.embedded) this.renderer.render(this.scene, this.camera); return; }
    // Cars glide to their latest tracked positions.
    const k = 1 - Math.exp(-dt * 5);
    if (this.carMeshes) {
      const { body, dark, shadow } = this.carMeshes;
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
      const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      const col = new THREE.Color();
      let i = 0;
      for (const car of this.cars.values()) {
        if (i >= MAX_CARS) break;
        car.x += (car.tx - car.x) * k;
        car.z += (car.tz - car.z) * k;
        const dh = Math.atan2(Math.sin(car.th - car.h), Math.cos(car.th - car.h));
        car.h += dh * k;
        q.setFromAxisAngle(up, -car.h);
        mtx.compose(new THREE.Vector3(car.x, 0, car.z), q, one);
        body.setMatrixAt(i, mtx);
        dark.setMatrixAt(i, mtx);
        const sq = new THREE.Quaternion().setFromAxisAngle(up, -car.h).multiply(flat);
        mtx.compose(new THREE.Vector3(car.x, 0.04, car.z), sq, one);
        shadow.setMatrixAt(i, mtx);
        col.set(car.you ? this.theme.ghost : car.color || "#9ca3af");
        body.instanceColor.setXYZ(i, col.r, col.g, col.b);
        i += 1;
      }
      for (const m of [body, dark, shadow]) { m.count = i; m.instanceMatrix.needsUpdate = true; }
      body.instanceColor.needsUpdate = true;
    }

    // Who the camera follows: your car (live), or the route preview car.
    const { route, target, ego, live } = this.data;
    let egoPose = null;
    let remaining = Infinity;
    const lotLen = route?.length > 1 ? route.reduce((s, p, i) => (i ? s + Math.hypot(p.x - route[i - 1].x, p.y - route[i - 1].y) : 0), 0) : 0;
    if (ego) {
      egoPose = { x: ego.x * this.m, z: ego.y * this.m, heading: ego.heading ?? 0 };
      remaining = lotLen * this.m;
      this.ghostCar.group.visible = false;
    } else if (route?.length > 1 && !live) {
      // Route preview: a car drives the route at lot speed, then starts over.
      if (this.ghost.pause > 0) this.ghost.pause -= dt;
      else {
        this.ghost.d += (4 / this.m) * dt;
        if (this.ghost.d >= lotLen) { this.ghost.d = lotLen; this.ghost.pause = 2.5; this.ghost.restart = true; }
      }
      if (this.ghost.pause <= 0 && this.ghost.restart) { this.ghost.d = 0; this.ghost.restart = false; }
      const p = pointAlong(route, this.ghost.d);
      const last = route.length >= 2 ? Math.atan2(route[route.length - 1].y - route[route.length - 2].y, route[route.length - 1].x - route[route.length - 2].x) : 0;
      egoPose = { x: p.x * this.m, z: p.y * this.m, heading: p.done ? last : p.heading };
      if (this.ghostPose) {
        const dh = Math.atan2(Math.sin(egoPose.heading - this.ghostPose.heading), Math.cos(egoPose.heading - this.ghostPose.heading));
        egoPose.heading = this.ghostPose.heading + dh * Math.min(1, dt * 6);
      }
      this.ghostPose = egoPose;
      remaining = (lotLen - this.ghost.d) * this.m;
      const g = this.ghostCar.group;
      g.visible = true;
      g.position.set(egoPose.x, 0, egoPose.z);
      g.rotation.y = -egoPose.heading;
      this.ghostCar.halo.material.opacity = 0.35 + 0.35 * Math.sin(time * 4) ** 2;
      if (this.onProgress && time - (this.lastProgress || 0) > 0.25) { this.lastProgress = time; this.onProgress(this.ghost.d * this.m); }
    } else {
      this.ghostCar.group.visible = false;
      if (route?.length > 1) {
        const a = route[0], b2 = route[1];
        egoPose = { x: a.x * this.m, z: a.y * this.m, heading: Math.atan2(b2.y - a.y, b2.x - a.x) };
        remaining = lotLen * this.m;
      }
    }

    // Route arrows move; the target pin floats.
    if (this.routeTexture) this.routeTexture.offset.y -= dt * 0.9;
    if (this.walkTexture) this.walkTexture.offset.y -= dt * 0.35;
    if (this.marker) {
      this.marker.pin.position.y = 1.6 + Math.sin(time * 2.2) * 0.25;
      const s = 1 + ((time * 0.8) % 1) * 1.6;
      this.marker.ring.scale.set(s, s, s);
      this.marker.ring.material.opacity = 1 - ((time * 0.8) % 1);
    }

    if (this.embedded) return; // the host map has the camera
    // Camera.
    if (this.mode === "free") {
      this.controls.update();
    } else {
      const want = this.mode === "driver" && egoPose ? this.driverView(egoPose, remaining) : this.birdView();
      const kc = 1 - Math.exp(-dt * (this.mode === "driver" ? 3 : 2.2));
      this.cam.pos.lerp(want.pos, kc);
      this.cam.look.lerp(want.look, kc);
      this.camera.position.copy(this.cam.pos);
      this.camera.lookAt(this.cam.look);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------- helpers

function inside(p, poly) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

// A flat strip between two ground points (painted line, outline).
function stripe(a, b, w) {
  const d = new THREE.Vector3().subVectors(b, a);
  const n = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(w / 2);
  return [a.clone().add(n), b.clone().add(n), b.clone().sub(n), a.clone().sub(n)];
}

function mergeQuads(quads) {
  const pos = new Float32Array(quads.length * 12), idx = [];
  quads.forEach((q, i) => {
    q.forEach((v, k) => pos.set([v.x, v.y, v.z], (i * 4 + k) * 3));
    idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

function quadGeo(P) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P.flatMap((v) => [v.x, v.y, v.z])), 3));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  return geo;
}

// Polygon {outer, holes} in lot units -> extruded solid (caps group 0, sides 1).
export function extrude(poly, height, m) {
  if (!poly?.outer || poly.outer.length < 3) return null;
  // Shape (x, -z) rotated -90° about x lies on the ground with z = lot y.
  const toShape = (ring) => ring.map((p) => new THREE.Vector2(p.x * m, -p.y * m));
  const outer = toShape(poly.outer);
  if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const h of poly.holes || []) {
    const hole = toShape(h);
    if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
    shape.holes.push(new THREE.Path(hole));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// Rounded corners for the route line (drivers do not turn on a point).
function roundCorners(pts, radius) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r = Math.min(radius, a.distanceTo(b) / 2, b.distanceTo(c) / 2);
    const p0 = b.clone().add(a.clone().sub(b).setLength(r)), p1 = b.clone().add(c.clone().sub(b).setLength(r));
    for (let k = 0; k <= 6; k += 1) {
      const t = k / 6;
      out.push(new THREE.Vector2(
        (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * b.x + t * t * p1.x,
        (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * b.y + t * t * p1.y,
      ));
    }
  }
  out.push(pts[pts.length - 1]);
  return out.filter((p, i) => i === 0 || p.distanceTo(out[i - 1]) > 1e-4);
}

// A flat ribbon along a path (x, z), with v running along it in metres / 3.
export function ribbon(pts, width, y) {
  const pos = [], uv = [], idx = [];
  let along = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    const d = next.clone().sub(prev).normalize();
    const n = new THREE.Vector2(-d.y, d.x).multiplyScalar(width / 2);
    if (i) along += pts[i].distanceTo(pts[i - 1]);
    pos.push(pts[i].x + n.x, y, pts[i].y + n.y, pts[i].x - n.x, y, pts[i].y - n.y);
    uv.push(0, along / 3, 1, along / 3);
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// Route line: the route colour with white chevrons pointing the way (+v).
function chevronTexture(color) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = color;
  x.fillRect(0, 0, 64, 128);
  // Canvas top is v = 1 (ahead): the tip of the chevron points up.
  x.strokeStyle = "rgba(255,255,255,0.95)";
  x.lineWidth = 8;
  x.lineCap = "round";
  x.lineJoin = "round";
  x.beginPath();
  x.moveTo(16, 84); x.lineTo(32, 52); x.lineTo(48, 84);
  x.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Walking route: round dots (footsteps) in the walk colour.
function dotsTexture(color) {
  const c = document.createElement("canvas");
  c.width = 32; c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = color;
  x.beginPath();
  x.arc(16, 32, 11, 0, Math.PI * 2);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let blobCache = null;
function blobTexture() {
  if (blobCache) return blobCache;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 6, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  blobCache = new THREE.CanvasTexture(c);
  return blobCache;
}

export function makeLabel(text, { bg = "#0f172a", fg = "#fff", bold = true, round = false } = {}) {
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  const font = `${bold ? 800 : 600} 44px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  x.font = font;
  const w = round ? 72 : Math.ceil(x.measureText(text).width) + 44;
  c.width = w; c.height = 72;
  x.font = font;
  x.fillStyle = bg;
  x.beginPath();
  x.roundRect(0, 0, w, 72, 36);
  x.fill();
  x.fillStyle = fg;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, w / 2, 38);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Labels keep the same size on screen at any distance (like map labels).
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }));
  sprite.renderOrder = 20;
  return { sprite, texture, aspect: w / 72 };
}

// A clean sedan, centred, nose along +x: body (paint) and glass/tyres (dark).
// Shared with the campus map (cars in live lots).
export const carParts = () => carGeometries();
export const CAR_SIZE = { length: 4.6, width: 1.85 };
let carCache = null;
function carGeometries() {
  if (carCache) return carCache;
  const L = CAR.length, Wd = CAR.width;
  const side = (pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  // Lower body: bumpers, hood and boot, up to the window line.
  const lower = new THREE.ExtrudeGeometry(side([
    [-L / 2, 0.28], [L / 2 - 0.05, 0.28], [L / 2, 0.45], [L / 2, 0.7], [L / 2 - 0.25, 0.86], [0.85, 0.98],
    [-1.55, 1.0], [-L / 2 + 0.12, 0.92], [-L / 2, 0.72],
  ]), { depth: Wd - 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 2 });
  lower.translate(0, 0, -(Wd - 0.1) / 2);
  // Glass house.
  const glass = new THREE.ExtrudeGeometry(side([
    [0.9, 0.97], [0.15, 1.38], [-1.0, 1.4], [-1.62, 1.0],
  ]), { depth: Wd - 0.34, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  glass.translate(0, 0, -(Wd - 0.34) / 2);
  // Roof panel in body colour.
  const roof = new THREE.BoxGeometry(1.0, 0.05, Wd - 0.42).toNonIndexed();
  roof.translate(-0.42, 1.42, 0);
  // Tyres.
  const tyres = [];
  for (const [x, z] of [[1.35, 1], [1.35, -1], [-1.4, 1], [-1.4, -1]]) {
    const t = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14).toNonIndexed();
    t.rotateX(Math.PI / 2);
    t.translate(x, 0.34, z * (Wd / 2 - 0.12));
    tyres.push(t);
  }
  const strip = (g) => { g.deleteAttribute("uv"); return g; };
  carCache = {
    body: mergeGeometries([strip(lower), strip(roof)]),
    dark: mergeGeometries([strip(glass), ...tyres.map(strip)]),
  };
  return carCache;
}
