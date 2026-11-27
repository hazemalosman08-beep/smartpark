// A whole complex in 3D from OpenStreetMap data (see src/lib/osm.js):
// buildings at their real heights, roads at their real widths, parking lots
// and garages labelled, grass, water and trees. Units are metres
// (x east, z south, y up).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { extrude, makeLabel, ribbon } from "./lotScene.js";

const THEMES = {
  dark: {
    bg: 0x0b1117, ground: 0x18212a, grass: 0x1f4a33, wood: 0x173b29, pitch: 0x245a3a, water: 0x1d4f7a,
    road: 0x2c3640, roadEdge: 0x48525d, path: 0x3a4550, rail: 0x55606b,
    lot: 0x323d48, lotEdge: 0x94a3b8, garage: 0x55606d, garageRoof: 0x6b7785,
    wall: 0x3a4655, roof: 0x4a5869, edge: 0x8ea0b5, tree: 0x2f7a4c, trunk: 0x4b3a2a,
    hemi: [0xbfd4ff, 0x1a1f24, 1.0], sun: 1.1, lotLabel: "#0ea5e9",
  },
  light: {
    bg: 0xeef2f6, ground: 0xe3e8ee, grass: 0xbfe3b4, wood: 0x9fd197, pitch: 0xa8dba0, water: 0x9cc9ef,
    road: 0xffffff, roadEdge: 0xd0d6dd, path: 0xf6f1e7, rail: 0xb9bec4,
    lot: 0xcfd5dc, lotEdge: 0x7b8794, garage: 0xc9ced4, garageRoof: 0xdfe3e8,
    wall: 0xe9ecef, roof: 0xf6f7f8, edge: 0x9aa5b1, tree: 0x6fbf73, trunk: 0x8a6b4a,
    hemi: [0xffffff, 0x9aa3ad, 1.0], sun: 0.9, lotLabel: "#0284c7",
  },
};

export class CampusScene {
  constructor(canvas, { onPick = null } = {}) {
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 6000;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.position.set(-0.5, 1, 0.35);
    this.scene.add(this.hemi, this.sun);
    this.root = new THREE.Group();
    this.labels = new THREE.Group();
    this.trip = new THREE.Group();
    this.scene.add(this.root, this.labels, this.trip);
    this.tripData = null;
    this.themeName = "dark";
    this.theme = THEMES.dark;
    this.osm = null;
    this.onPick = onPick;
    if (import.meta.env?.DEV) window.__campusScene = this;
    this.pickables = [];
    this.flight = null;
    this.raycaster = new THREE.Raycaster();
    canvas.addEventListener("pointerdown", (e) => { this.down = [e.clientX, e.clientY]; });
    canvas.addEventListener("pointerup", (e) => {
      if (!this.down || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5) return;
      this.pick(e, canvas);
    });
  }

  start() {
    this.running = true;
    let last = 0;
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (document.hidden || t - last < 24) return;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (this.flight) {
        const f = this.flight;
        f.t = Math.min(1, f.t + dt / f.dur);
        const k = f.t * f.t * (3 - 2 * f.t);
        this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
        this.controls.target.lerpVectors(f.fromLook, f.toLook, k);
        if (f.t >= 1) this.flight = null;
      }
      this.controls.update();
      if (t - (this.lastDeclutter || 0) > 150) { this.lastDeclutter = t; this.declutter(); }
      this.renderer.render(this.scene, this.camera);
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
    this.clear();
    this.renderer.dispose();
  }

  clear() {
    for (const g of [this.root, this.labels]) {
      for (const o of [...g.children]) {
        g.remove(o);
        o.traverse?.((c) => {
          c.geometry?.dispose?.();
          const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
          mats.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
        });
      }
    }
    this.pickables = [];
  }

  /**
   * "Where are you going?": highlight the building, the parking options and
   * the walk from the chosen one. trip: { building, options:[{lot, from, to}], chosen } or null.
   */
  setTrip(trip, { fly = true } = {}) {
    this.tripData = trip;
    for (const o of [...this.trip.children]) {
      this.trip.remove(o);
      o.traverse?.((c) => { c.geometry?.dispose?.(); const m = c.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
    }
    if (!trip?.building) return;
    const b = trip.building;
    const geo = extrude(b, b.height + 0.3, 1);
    if (geo) {
      // Drawn over the ordinary building (no flicker where they coincide).
      const mat = (color, emissive) => new THREE.MeshLambertMaterial({ color, emissive, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      this.trip.add(new THREE.Mesh(geo, [mat(0xfbbf24, 0x3a2a00), mat(0xf59e0b, 0x2a1a00)]));
    }
    const bc = centre(b.outer);
    const bl = makeLabel(b.name, { bg: "#f59e0b", fg: "#1c1917" });
    bl.sprite.position.set(bc.x, b.height + 10, bc.y);
    bl.sprite.scale.set(bl.aspect * 0.03, 0.03, 1);
    bl.sprite.renderOrder = 30;
    this.trip.add(bl.sprite);
    (trip.options || []).forEach((o, i) => {
      const isChosen = o === trip.chosen;
      const lot = o.lot;
      const fill = flatGeo(lot, 1.2);
      if (fill) {
        const m = new THREE.Mesh(fill, new THREE.MeshBasicMaterial({ color: isChosen ? 0x22c55e : 0x4ade80, transparent: true, opacity: isChosen ? 0.8 : 0.4, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -20, polygonOffsetUnits: -20 }));
        m.renderOrder = 20;
        this.trip.add(m);
      }
      const garage = this.osm?.buildings.find((x) => x.garage && x.name && x.name === lot.name);
      if (garage && isChosen) {
        const g = extrude(garage, garage.height + 0.4, 1);
        if (g) this.trip.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x22c55e, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
      }
      const c = centre(lot.outer);
      const label = makeLabel(`${i + 1}  ${lot.name || "Parking"} · ${o.walkMinutes} min walk`, { bg: isChosen ? "#16a34a" : "#166534", fg: "#fff" });
      label.sprite.position.set(c.x, (garage?.height || 0) + (isChosen ? 12 : 8), c.y);
      label.sprite.scale.set(label.aspect * (isChosen ? 0.028 : 0.022), isChosen ? 0.028 : 0.022, 1);
      label.sprite.renderOrder = isChosen ? 29 : 25;
      label.sprite.userData.trip = o;
      this.trip.add(label.sprite);
    });
    // The walk: dotted line from the chosen lot to the building.
    const ch = trip.chosen;
    if (ch && ch.distance > 0) {
      // A row of footstep dots (lines are 1 px wide in WebGL: too thin to see).
      const len = Math.hypot(ch.to.x - ch.from.x, ch.to.y - ch.from.y);
      const n = Math.max(2, Math.round(len / 6));
      const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(1.4, 16), new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthWrite: false, side: THREE.DoubleSide }), n + 1);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      for (let k = 0; k <= n; k += 1) {
        const t = k / n;
        m4.compose(new THREE.Vector3(ch.from.x + (ch.to.x - ch.from.x) * t, 1.6, ch.from.y + (ch.to.y - ch.from.y) * t), q, new THREE.Vector3(1, 1, 1));
        dots.setMatrixAt(k, m4);
      }
      dots.renderOrder = 28;
      this.trip.add(dots);
    }
    // Ordinary labels near the trip step aside.
    if (fly) {
      const pts = [...b.outer, ...(ch ? ch.lot.outer : [])];
      const xs = pts.map((p) => p.x), zs = pts.map((p) => p.y);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      this.flyTo({ x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 }, Math.max(160, span * 1.5));
    }
  }

  setTheme(name) {
    if (name === this.themeName) return;
    this.themeName = name;
    this.theme = THEMES[name] || THEMES.dark;
    if (this.osm) { this.build(); this.fitFog(); if (this.tripData) this.setTrip(this.tripData, { fly: false }); }
  }

  fitFog() {
    const d = this.camera.position.distanceTo(this.controls.target);
    if (this.scene.fog) { this.scene.fog.near = Math.max(6000, d * 2.5); this.scene.fog.far = Math.max(20000, d * 6); }
  }

  setData(osm, { fit = true } = {}) {
    this.osm = osm;
    this.build();
    if (fit) this.fit(true);
  }

  build() {
    this.clear();
    const t = this.theme, osm = this.osm;
    if (!osm) return;
    this.scene.background = new THREE.Color(t.bg);
    // Fog far beyond what is in view (set from the view distance in fit()).
    this.scene.fog = new THREE.Fog(t.bg, 6000, 20000);
    this.hemi.color.set(t.hemi[0]); this.hemi.groundColor.set(t.hemi[1]); this.hemi.intensity = t.hemi[2];
    this.sun.intensity = t.sun;
    const box = this.extent();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(box.w + 4000, box.h + 4000), new THREE.MeshBasicMaterial({ color: t.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(box.cx, -0.1, box.cz);
    this.root.add(ground);

    const flat = (polys, color, y, order) => {
      const geos = polys.map((p) => flatGeo(p, y)).filter(Boolean);
      if (!geos.length) return null;
      const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order }));
      mesh.renderOrder = order;
      this.root.add(mesh);
      return mesh;
    };
    flat(osm.green.filter((g) => g.kind === "grass"), t.grass, 0.02, 1);
    flat(osm.green.filter((g) => g.kind === "wood"), t.wood, 0.03, 2);
    flat(osm.green.filter((g) => g.kind === "pitch"), t.pitch, 0.04, 3);
    flat(osm.water.filter((w) => w.outer), t.water, 0.05, 4);

    // Lines: rivers, rails, paths, roads (wider first, so junctions look clean).
    const lines = (items, width, color, y, order) => {
      const geos = [];
      for (const it of items) {
        const pts = it.line.map((p) => new THREE.Vector2(p.x, p.y));
        if (pts.length >= 2) geos.push(ribbon(pts, typeof width === "function" ? width(it) : width, y));
      }
      if (!geos.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => { g.deleteAttribute("uv"); return g; })), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order }));
      mesh.renderOrder = order;
      this.root.add(mesh);
    };
    lines(osm.water.filter((w) => w.line), (w) => w.width, t.water, 0.05, 4);
    lines(osm.rails, 2.5, t.rail, 0.06, 5);
    lines(osm.paths, 2.2, t.path, 0.07, 6);
    lines(osm.roads, (r) => r.width + 1.2, t.roadEdge, 0.08, 7);
    lines(osm.roads, (r) => r.width, t.road, 0.09, 8);

    // Surface parking lots: flat, outlined, clickable.
    const lots = osm.parking.filter((p) => !p.space && !/multi|underground|rooftop/.test(p.kind));
    for (const lot of lots) {
      const mesh = flat([lot], t.lot, 0.12, 9);
      if (mesh) { mesh.userData.lot = lot; this.pickables.push(mesh); }
      const pts = [...lot.outer, lot.outer[0]].map((p) => new THREE.Vector3(p.x, 0.2, p.y));
      this.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: t.lotEdge })));
    }
    const spaces = osm.parking.filter((p) => p.space);
    if (spaces.length) {
      const segs = [];
      for (const s of spaces) for (let i = 0; i < s.outer.length; i += 1) {
        const a = s.outer[i], b = s.outer[(i + 1) % s.outer.length];
        segs.push(new THREE.Vector3(a.x, 0.22, a.y), new THREE.Vector3(b.x, 0.22, b.y));
      }
      this.root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color: this.themeName === "dark" ? 0xe2e8f0 : 0xffffff })));
    }

    // Buildings: one merged mesh for ordinary ones, garages apart (clickable).
    const ordinary = [], garages = [];
    for (const b of osm.buildings) {
      const geo = extrude(b, Math.max(1, b.height - (b.minHeight || 0)), 1);
      if (!geo) continue;
      if (b.minHeight) geo.translate(0, b.minHeight, 0);
      (b.garage ? garages : ordinary).push({ geo, b });
    }
    if (ordinary.length) {
      // Roofs and walls coloured per vertex, so all buildings are one mesh
      // (one draw call) whatever their count.
      const roof = new THREE.Color(t.roof), wall = new THREE.Color(t.wall);
      const geo = mergeGeometries(ordinary.map((o) => paintGroups(o.geo, [roof, wall])));
      this.root.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
      this.root.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), new THREE.LineBasicMaterial({ color: t.edge, transparent: true, opacity: 0.35 })));
    }
    for (const { geo, b } of garages) {
      const mesh = new THREE.Mesh(geo, [new THREE.MeshLambertMaterial({ color: t.garageRoof }), new THREE.MeshLambertMaterial({ color: t.garage })]);
      const lot = osm.parking.find((p) => p.name && p.name === b.name) || { name: b.name, kind: "multi-storey", outer: b.outer, capacity: null };
      mesh.userData.lot = lot;
      this.pickables.push(mesh);
      this.root.add(mesh);
      // Floor lines on the sides: it reads as a parking structure.
      const floors = Math.max(1, Math.round(b.height / 3));
      const segs = [];
      for (let f = 1; f < floors; f += 1) {
        const y = (b.height * f) / floors;
        for (let i = 0; i < b.outer.length; i += 1) {
          const p = b.outer[i], q = b.outer[(i + 1) % b.outer.length];
          segs.push(new THREE.Vector3(p.x, y, p.y), new THREE.Vector3(q.x, y, q.y));
        }
      }
      if (segs.length) this.root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color: this.themeName === "dark" ? 0x9aa7b5 : 0x7b8794 })));
    }

    // Trees.
    if (osm.trees.length) {
      const n = osm.trees.length;
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 1, 6), new THREE.MeshLambertMaterial({ color: t.trunk }), n);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: t.tree, flatShading: true }), n);
      const m = new THREE.Matrix4();
      osm.trees.forEach((p, i) => {
        const s = 2.6 + ((i * 7919) % 100) / 100 * 1.6;
        m.compose(new THREE.Vector3(p.x, 1.6, p.y), new THREE.Quaternion(), new THREE.Vector3(1, 3.2, 1)); trunk.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(p.x, 3 + s * 0.7, p.y), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.9, s)); crown.setMatrixAt(i, m);
      });
      this.root.add(trunk, crown);
    }

    // Labels: every parking lot and garage (P + name).
    // Named lots and garages only: hundreds of "Parking" labels hide the map.
    for (const lot of osm.parking.filter((p) => !p.space && p.name)) {
      const c = centre(lot.outer);
      const garage = /multi|underground|rooftop/.test(lot.kind);
      const bld = garage ? osm.buildings.find((b) => b.garage && b.name === lot.name) : null;
      const text = `P ${lot.name || (garage ? "Parking structure" : "Parking")}${lot.capacity ? ` · ${lot.capacity}` : ""}`;
      const label = makeLabel(text, { bg: this.theme.lotLabel, fg: "#fff" });
      label.sprite.position.set(c.x, (bld?.height || 0) + 8, c.y);
      label.sprite.scale.set(label.aspect * 0.025, 0.025, 1);
      label.sprite.userData.lot = lot;
      label.sprite.userData.rank = (garage ? 2000 : 0) + (lot.capacity || 0);
      this.labels.add(label.sprite);
    }
  }

  // Labels that would overlap on screen are hidden; bigger lots and garages
  // win. Zooming in shows more of them.
  declutter() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (!w || !h || !this.labels.children.length) return;
    const placed = [];
    const v = new THREE.Vector3();
    for (const sp of this.trip.children.filter((c) => c.isSprite)) {
      v.copy(sp.position).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h, lh = sp.scale.y * h, lw = sp.scale.x * h;
      placed.push([x - lw / 2 - 4, y - lh / 2 - 3, x + lw / 2 + 4, y + lh / 2 + 3]);
    }
    const items = [...this.labels.children].sort((a, b) => (b.userData.rank || 0) - (a.userData.rank || 0));
    for (const sp of items) {
      v.copy(sp.position).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const lh = sp.scale.y * h, lw = sp.scale.x * h;
      const box = [x - lw / 2 - 4, y - lh / 2 - 3, x + lw / 2 + 4, y + lh / 2 + 3];
      const onScreen = v.z < 1 && x > -lw && x < w + lw && y > -lh && y < h + lh;
      const free = onScreen && !placed.some((q) => box[0] < q[2] && q[0] < box[2] && box[1] < q[3] && q[1] < box[3]);
      sp.visible = free;
      if (free) placed.push(box);
    }
  }

  extent() {
    const pts = [...this.osm.buildings.flatMap((b) => b.outer), ...this.osm.parking.flatMap((p) => p.outer)];
    if (!pts.length) return { cx: 0, cz: 0, w: 500, h: 500 };
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, h: z1 - z0 };
  }

  fit(snap = false) {
    const b = this.extent();
    // Far enough that the whole complex fits, seen tilted.
    const dist = Math.max(b.w / Math.max(0.6, this.camera.aspect), b.h) * 1.4 + 60;
    if (this.scene.fog) { this.scene.fog.near = dist * 2.5; this.scene.fog.far = dist * 6; }
    this.camera.far = Math.max(20000, dist * 8);
    this.camera.updateProjectionMatrix();
    this.flyTo({ x: b.cx, z: b.cz }, Math.max(150, dist), snap);
  }

  /** Fly to a point (metres), from `dist` away, tilted like a map app. */
  flyTo(target, dist = 250, snap = false) {
    const toLook = new THREE.Vector3(target.x, 0, target.z);
    const toPos = toLook.clone().add(new THREE.Vector3(0, dist * 0.8, dist * 0.6));
    if (snap) { this.camera.position.copy(toPos); this.controls.target.copy(toLook); this.controls.update(); return; }
    this.flight = { t: 0, dur: 1.1, fromPos: this.camera.position.clone(), toPos, fromLook: this.controls.target.clone(), toLook };
  }

  flyToLot(lot) {
    const c = centre(lot.outer);
    const xs = lot.outer.map((p) => p.x), zs = lot.outer.map((p) => p.y);
    this.flyTo({ x: c.x, z: c.y }, Math.max(90, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.4);
  }

  pick(e, canvas) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects([...this.trip.children.filter((c) => c.isSprite), ...this.pickables, ...this.labels.children], false)[0];
    if (hit?.object?.userData?.trip) { this.onPickTrip?.(hit.object.userData.trip); return; }
    const lot = hit?.object?.userData?.lot;
    if (lot) { this.flyToLot(lot); this.onPick?.(lot); }
  }
}

// Non-indexed extrusion with groups (0 caps, 1 sides) -> colour attribute.
function paintGroups(geo, colors) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
  for (const gr of groups) {
    const c = colors[gr.materialIndex] || colors[0];
    for (let i = gr.start; i < Math.min(n, gr.start + gr.count); i += 1) col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.clearGroups();
  if (g.getAttribute("uv")) g.deleteAttribute("uv");
  return g;
}

function centre(poly) {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

// A flat polygon (with holes) on the ground at height y.
function flatGeo(poly, y) {
  if (!poly.outer || poly.outer.length < 3) return null;
  const shape = new THREE.Shape(poly.outer.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of poly.holes || []) if (h.length >= 3) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  return geo;
}
