// A whole complex in 3D from OpenStreetMap data (see src/lib/osm.js):
// buildings at their real heights, roads at their real widths, parking lots
// and garages labelled, grass, water and trees. Units are metres
// (x east, z south, y up).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { extrude, ribbon } from "./lotScene.js";
import { LEVEL_COLOR, occupancyLevel } from "../occupancySim.js";

// Map-app palettes. "site" is the complex's own buildings; "around" the
// neighbourhood (drawn closer to the ground colour so the complex stands out).
const THEMES = {
  dark: {
    bg: 0x0c1218, ground: 0x151c24, grass: 0x18301f, wood: 0x15291c, pitch: 0x1b3a26, water: 0x123150,
    road: 0x2b3540, roadMajor: 0x3d4855, roadEdge: 0x10161c, path: 0x26303a, rail: 0x4a5561,
    lot: 0x163352, lotEdge: 0x3b82c4, garage: 0x1d4f80, garageRoof: 0x2a6aa6,
    siteRoof: 0x6a7c92, siteWall: 0x4b5a6d, aroundRoof: 0x2e3946, aroundWall: 0x232c37,
    edge: 0x9fb2c8, tree: 0x24603b, trunk: 0x3d3022,
    hemi: [0xcfe0ff, 0x10141a, 1.9], sun: 1.6,
    lotLabel: "#1d70c2", buildingLabel: "rgba(15,23,32,0.82)", buildingText: "#dbe4ee", outline: 0xf59e0b,
  },
  light: {
    bg: 0xe9edf1, ground: 0xe4e8ec, grass: 0xcde6c3, wood: 0xb8dbb0, pitch: 0xbfe0b5, water: 0xa9d1f2,
    road: 0xffffff, roadMajor: 0xfff3c4, roadEdge: 0xcfd5dc, path: 0xf4efe6, rail: 0xb7bcc2,
    lot: 0xd3e4f7, lotEdge: 0x5b9bd8, garage: 0x9cc3ea, garageRoof: 0xbcd7f2,
    siteRoof: 0xfbfbfc, siteWall: 0xd5dbe3, aroundRoof: 0xeef0f3, aroundWall: 0xdfe3e8,
    edge: 0x8d99a6, tree: 0x7cc27f, trunk: 0x8a6b4a,
    hemi: [0xffffff, 0xaab3bd, 2.05], sun: 1.15,
    lotLabel: "#1d70c2", buildingLabel: "rgba(255,255,255,0.9)", buildingText: "#1f2937", outline: 0xe08a00,
  },
};

const MAJOR = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/;

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
      this.keepInside();
      if (t - (this.lastDeclutter || 0) > 150) { this.lastDeclutter = t; this.declutter(); }
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  // The view stays over the map (it fades out at its edge), and fine detail
  // is dropped when zoomed far out.
  keepInside() {
    const R = this.radius;
    if (!R) return;
    const t = this.controls.target;
    const d = Math.hypot(t.x, t.z);
    if (d > R) {
      const k = R / d, dx = t.x * k - t.x, dz = t.z * k - t.z;
      t.x += dx; t.z += dz;
      this.camera.position.x += dx; this.camera.position.z += dz;
    }
    const far = this.camera.position.distanceTo(t) > R * 1.4;
    if (this.detail) for (const o of this.detail) o.visible = !far;
  }

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
    const bl = mapLabel(b.name, { bg: "#f59e0b", fg: "#1c1917" });
    bl.sprite.position.set(bc.x, b.height + 10, bc.y);
    bl.sprite.scale.set(bl.aspect * 0.029, 0.029, 1);
    bl.sprite.renderOrder = 30;
    bl.sprite.userData.rank = 3;
    this.trip.add(bl.sprite);
    (trip.options || []).forEach((o, i) => {
      const isChosen = o === trip.chosen;
      const lot = o.lot;
      const fill = isChosen || !this.occ ? flatGeo(lot, 1.2) : null;
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
      // The chosen lot is named; the other options are short numbered pins.
      const live = this.occ?.get(lot.id);
      const free = live ? ` · ${live.free ? `${live.free} free` : "full"}` : "";
      const label = isChosen
        ? mapLabel(`${lot.name || "Parking"} · ${o.walkMinutes} min walk${free}`, { bg: "#16a34a", fg: "#fff", badge: String(i + 1), badgeBg: "#ffffff", badgeFg: "#15803d" })
        : mapLabel(`${o.walkMinutes} min${free}`, { bg: "#14532d", fg: "#dcfce7", badge: String(i + 1), badgeBg: "#22c55e", badgeFg: "#052e16", weight: 600 });
      const sc = isChosen ? 0.028 : 0.022;
      label.sprite.position.set(c.x, (garage?.height || 0) + (isChosen ? 12 : 8), c.y);
      label.sprite.scale.set(label.aspect * sc, sc, 1);
      label.sprite.renderOrder = isChosen ? 29 : 25;
      label.sprite.userData.rank = isChosen ? 2 : 1 - i / 10;
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
    radialFog(this.trip);
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

  // The fog fades the map out by distance from its centre (see radialFog),
  // not from the camera: zoomed out, the complex sits on a soft round map
  // instead of a hard-edged slab.
  fitFog() {
    if (this.scene.fog && this.radius) { this.scene.fog.near = this.radius * 0.8; this.scene.fog.far = this.radius * 1.25; }
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
    this.radius = this.mapRadius();
    this.scene.fog = new THREE.Fog(t.bg, 1, 2);
    this.fitFog();
    this.detail = [];
    this.hemi.color.set(t.hemi[0]); this.hemi.groundColor.set(t.hemi[1]); this.hemi.intensity = t.hemi[2];
    this.sun.intensity = t.sun;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(this.radius * 3, 96), new THREE.MeshBasicMaterial({ color: t.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.1, 0);
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
    lines(osm.paths, 2, t.path, 0.07, 6);
    lines(osm.roads, (r) => r.width + 1.6, t.roadEdge, 0.08, 7);
    lines(osm.roads.filter((r) => !MAJOR.test(r.kind)), (r) => r.width, t.road, 0.09, 8);
    lines(osm.roads.filter((r) => MAJOR.test(r.kind)), (r) => r.width, t.roadMajor, 0.095, 8);

    // Surface parking lots: flat, outlined, clickable.
    const lots = osm.parking.filter((p) => !p.space && (p.point || !/multi|underground|rooftop/.test(p.kind)));
    this.lotMesh = new Map();
    for (const lot of lots) {
      const mesh = flat([lot], t.lot, 0.12, 9);
      if (mesh) { mesh.userData.lot = lot; this.pickables.push(mesh); this.lotMesh.set(lot.id, mesh); }
    }
    const rims = lots.map((lot) => ribbon([...lot.outer, lot.outer[0]].map((p) => new THREE.Vector2(p.x, p.y)), 1.2, 0.15)).filter(Boolean);
    if (rims.length) {
      const rim = new THREE.Mesh(mergeGeometries(rims.map((g) => { if (g.getAttribute("uv")) g.deleteAttribute("uv"); return g; })),
        new THREE.MeshBasicMaterial({ color: t.lotEdge, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 }));
      rim.renderOrder = 10;
      this.root.add(rim);
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
      // (one draw call) whatever their count. Buildings outside the
      // complex's outline are faded towards the ground colour.
      const site = [new THREE.Color(t.siteRoof), new THREE.Color(t.siteWall)];
      const around = [new THREE.Color(t.aroundRoof), new THREE.Color(t.aroundWall)];
      const geo = mergeGeometries(ordinary.map((o) => paintGroups(o.geo, o.b.inComplex === false ? around : site)));
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.userData.buildings = true;
      this.pickables.push(mesh);
      this.root.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), new THREE.LineBasicMaterial({ color: t.edge, transparent: true, opacity: this.themeName === "dark" ? 0.22 : 0.35 }));
      this.root.add(edges);
      this.detail.push(edges);
    }
    for (const { geo, b } of garages) {
      const mesh = new THREE.Mesh(paintGroups(geo, [new THREE.Color(t.garageRoof), new THREE.Color(t.garage)]), new THREE.MeshLambertMaterial({ vertexColors: true }));
      const lot = osm.parking.find((p) => p.name && p.name === b.name) || { name: b.name, kind: "multi-storey", outer: b.outer, capacity: null };
      mesh.userData.lot = lot;
      this.pickables.push(mesh);
      this.root.add(mesh);
      // Roof cap coloured by occupancy (hidden until there is data).
      if (lot.id) {
        const capGeo = flatGeo(b, b.height + 0.25);
        if (capGeo) {
          const cap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color: t.garageRoof, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
          cap.visible = false;
          cap.userData.lot = lot;
          cap.userData.cap = true;
          this.root.add(cap);
          this.lotMesh.set(lot.id, cap);
        }
      }
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
      this.detail.push(trunk, crown);
    }

    // The complex's outline on the ground.
    const rim = (osm.outline || []).map((o) => ribbon([...o.outer, o.outer[0]].map((p) => new THREE.Vector2(p.x, p.y)), 4, 0.3)).filter(Boolean);
    if (rim.length) {
      const mesh = new THREE.Mesh(mergeGeometries(rim.map((g) => { if (g.getAttribute("uv")) g.deleteAttribute("uv"); return g; })),
        new THREE.MeshBasicMaterial({ color: t.outline, transparent: true, opacity: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12 }));
      mesh.renderOrder = 12;
      this.root.add(mesh);
    }

    // Names of the complex's buildings (parking labels win when they overlap).
    const named = new Map();
    for (const b of osm.buildings) {
      if (!b.name || b.part || b.garage || b.inComplex === false) continue;
      const area = Math.abs(areaOf(b.outer));
      if (!named.has(b.name) || named.get(b.name).area < area) named.set(b.name, { b, area });
    }
    for (const { b, area } of named.values()) {
      const c = centre(b.outer);
      const label = mapLabel(b.name, { bg: t.buildingLabel, fg: t.buildingText, weight: 600 });
      label.sprite.position.set(c.x, b.height + 4, c.y);
      label.sprite.scale.set(label.aspect * 0.02, 0.02, 1);
      label.sprite.userData.building = b;
      label.sprite.userData.rank = -100000 + area;
      this.labels.add(label.sprite);
    }

    this.addLotLabels();
    radialFog(this.root);
    radialFog(this.labels);
    if (this.occ) this.paintOccupancy();
  }

  // Parking labels: name (and capacity), or with occupancy data the free
  // spaces, coloured green / amber / red. Named lots, plus unnamed ones big
  // enough to matter when there is data.
  addLotLabels() {
    const t = this.theme, osm = this.osm, occ = this.occ;
    for (const sp of [...this.labels.children]) {
      if (!sp.userData.lot) continue;
      this.labels.remove(sp);
      sp.material.map?.dispose(); sp.material.dispose();
    }
    for (const lot of osm.parking) {
      if (lot.space) continue;
      const o = occ?.get(lot.id);
      if (!lot.name && !(o && o.total >= 15)) continue;
      const c = centre(lot.outer);
      const garage = /multi|underground|rooftop/.test(lot.kind);
      const bld = garage ? osm.buildings.find((b) => b.garage && b.name === lot.name) : null;
      const name = lot.name || (garage ? "Parking structure" : "Parking");
      let label;
      if (o) {
        const level = occupancyLevel(o);
        label = mapLabel(`${name}  ${o.free ? `${o.free} free` : "Full"}`, { bg: LEVEL_COLOR[level], fg: level === "filling" ? "#1c1917" : "#fff", badge: "P", badgeFg: LEVEL_COLOR[level] });
      } else {
        label = mapLabel(`${name}${lot.capacity ? `  ${lot.capacity}` : ""}`, { bg: t.lotLabel, fg: "#fff", badge: "P" });
      }
      label.sprite.position.set(c.x, (bld?.height || 0) + 8, c.y);
      label.sprite.scale.set(label.aspect * 0.025, 0.025, 1);
      label.sprite.userData.lot = lot;
      label.sprite.userData.rank = (garage ? 2000 : 0) + (lot.name ? 1000 : 0) + (o?.total || lot.capacity || 0);
      this.labels.add(label.sprite);
    }
  }

  /** Occupancy per lot (Map id -> { free, total }) or null: colours and labels. */
  setOccupancy(occ) {
    this.occ = occ;
    if (!this.osm) return;
    this.paintOccupancy();
    if (this.tripData) this.setTrip(this.tripData, { fly: false });
  }

  paintOccupancy() {
    const t = this.theme, occ = this.occ;
    for (const [id, mesh] of this.lotMesh || []) {
      const o = occ?.get(id);
      if (mesh.userData.cap) {
        mesh.visible = Boolean(o);
        if (o) mesh.material.color.set(LEVEL_COLOR[occupancyLevel(o)]);
        continue;
      }
      mesh.material.color.set(t.lot);
      if (o) mesh.material.color.lerp(new THREE.Color(LEVEL_COLOR[occupancyLevel(o)]), this.themeName === "dark" ? 0.55 : 0.5);
    }
    this.addLotLabels();
    radialFog(this.labels);
  }

  /** Radius (m) of the downloaded area around the map's origin (its centre). */
  mapRadius() {
    const b = this.osm?.bounds;
    if (b && Number.isFinite(b.minlat)) {
      const kx = 111320 * Math.cos((((b.minlat + b.maxlat) / 2) * Math.PI) / 180);
      return Math.max(((b.maxlon - b.minlon) / 2) * kx, ((b.maxlat - b.minlat) / 2) * 110540) + 120;
    }
    const e = this.extent();
    return Math.max(e.w, e.h) / 2 + Math.hypot(e.cx, e.cz);
  }

  // Labels that would overlap on screen are hidden; bigger lots and garages
  // win. Zooming in shows more of them.
  declutter() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (!w || !h || (!this.labels.children.length && !this.trip.children.length)) return;
    const placed = [];
    const v = new THREE.Vector3();
    const px = 1 / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    // Trip labels first (the building and the chosen lot always show), then
    // the map's own labels by rank.
    const trip = this.trip.children.filter((c) => c.isSprite).sort((a, b) => (b.userData.rank || 0) - (a.userData.rank || 0));
    const items = [...trip, ...[...this.labels.children].sort((a, b) => (b.userData.rank || 0) - (a.userData.rank || 0))];
    for (const sp of items) {
      v.copy(sp.position).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      // Screen size of a fixed-size sprite: scale / (2 tan(fov/2)) of the view height.
      const lh = sp.scale.y * h * px, lw = sp.scale.x * h * px;
      // Roomy spacing (a calm map), fully on screen, clear of the corner
      // buttons and the attribution.
      const box = [x - lw / 2 - 10, y - lh / 2 - 8, x + lw / 2 + 10, y + lh / 2 + 8];
      const onScreen = v.z < 1 && x - lw / 2 > 4 && x + lw / 2 < w - 4 && y - lh / 2 > 4 && y + lh / 2 < h - 22 && !(x + lw / 2 > w - 100 && y - lh / 2 < 56);
      const always = sp.parent === this.trip && (sp.userData.rank || 0) >= 2;
      const free = always || (onScreen && !placed.some((q) => box[0] < q[2] && q[0] < box[2] && box[1] < q[3] && q[1] < box[3]));
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
    // The complex itself when it has an outline, else the whole map.
    const pts = (this.osm.outline || []).flatMap((o) => o.outer);
    let cx = 0, cz = 0, w = this.radius * 1.5, h = this.radius * 1.5;
    if (pts.length) {
      const xs = pts.map((p) => p.x), zs = pts.map((p) => p.y);
      cx = (Math.min(...xs) + Math.max(...xs)) / 2; cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      w = Math.min(w, Math.max(...xs) - Math.min(...xs) + 160); h = Math.min(h, Math.max(...zs) - Math.min(...zs) + 160);
    }
    const dist = Math.max(w / Math.max(0.6, this.camera.aspect), h) * 1.15 + 40;
    this.controls.maxDistance = Math.max(400, this.radius * 3);
    this.camera.far = Math.max(8000, this.radius * 12);
    this.camera.updateProjectionMatrix();
    this.flyTo({ x: cx, z: cz }, Math.max(150, dist), snap);
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
    if (lot) { this.flyToLot(lot); this.onPick?.(lot); return; }
    let building = hit?.object?.userData?.building;
    if (!building && hit?.object?.userData?.buildings) {
      // The merged mesh: the building under the hit point (the tallest if
      // several stack there).
      const pt = { x: hit.point.x, y: hit.point.z };
      building = this.osm.buildings.filter((b) => !b.garage && insidePoly(pt, b.outer)).sort((a, b) => (a.part - b.part) || b.height - a.height)[0];
      if (building?.part) building = this.osm.buildings.find((b) => !b.part && !b.garage && insidePoly(pt, b.outer)) || building;
    }
    if (building) this.onPick?.({ building });
  }
}

// Non-indexed extrusion with groups (0 caps, 1 sides) -> colour attribute.
// Walls darken towards the ground (cheap ambient occlusion), so buildings
// read as solid volumes rather than flat cut-outs.
function paintGroups(geo, colors) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute("position");
  const n = pos.count;
  let base = Infinity;
  for (let i = 0; i < n; i += 1) base = Math.min(base, pos.getY(i));
  const col = new Float32Array(n * 3);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
  for (const gr of groups) {
    const c = colors[gr.materialIndex] || colors[0];
    for (let i = gr.start; i < Math.min(n, gr.start + gr.count); i += 1) {
      const k = gr.materialIndex === 1 ? 0.6 + 0.4 * Math.min(1, (pos.getY(i) - base) / 14) : 1;
      col.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.clearGroups();
  if (g.getAttribute("uv")) g.deleteAttribute("uv");
  return g;
}

// Fog by distance from the map's centre (the origin) instead of from the
// camera: the map fades softly into the background at the edge of the
// downloaded area, at any zoom.
function radialFog(group) {
  group.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.userData.radialFog) continue;
      m.userData.radialFog = true;
      m.fog = true;
      const sprite = m.isSpriteMaterial;
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("#include <fog_vertex>", sprite
          ? "#ifdef USE_FOG\n vFogDepth = length((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz);\n#endif"
          : `#ifdef USE_FOG
  vec4 rfWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    rfWorld = instanceMatrix * rfWorld;
  #endif
  vFogDepth = length((modelMatrix * rfWorld).xz);
#endif`);
      };
      m.customProgramCacheKey = () => (sprite ? "radialFogSprite" : "radialFog");
      m.needsUpdate = true;
    }
  });
}

// Map labels: a rounded pill, optionally with a round badge (P, 1, 2…).
function mapLabel(text, { bg = "#0f172a", fg = "#fff", badge = "", badgeBg = "#ffffff", badgeFg = "#1d70c2", weight = 700 } = {}) {
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  const H = 64, pad = 22, font = `${weight} 34px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  x.font = font;
  const bw = badge ? 46 : 0;
  const w = Math.ceil(x.measureText(text).width) + pad * 2 + (badge ? bw + 4 : 0);
  c.width = w + 8; c.height = H + 8;
  x.font = font;
  x.shadowColor = "rgba(0,0,0,0.35)"; x.shadowBlur = 6; x.shadowOffsetY = 2;
  x.fillStyle = bg;
  x.beginPath(); x.roundRect(4, 2, w, H, H / 2); x.fill();
  x.shadowColor = "transparent";
  if (badge) {
    x.fillStyle = badgeBg;
    x.beginPath(); x.arc(4 + 9 + bw / 2, 2 + H / 2, bw / 2, 0, Math.PI * 2); x.fill();
    x.fillStyle = badgeFg; x.font = `800 30px ui-sans-serif, system-ui, sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(badge, 4 + 9 + bw / 2, 2 + H / 2 + 1);
    x.font = font;
  }
  x.fillStyle = fg; x.textAlign = "left"; x.textBaseline = "middle";
  x.fillText(text, 4 + pad + (badge ? bw - 6 : 0), 2 + H / 2 + 1);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }));
  sprite.renderOrder = 20;
  return { sprite, texture, aspect: c.width / c.height };
}

function areaOf(p) {
  let a = 0;
  for (let i = 0; i < p.length; i += 1) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; }
  return a / 2;
}

function insidePoly(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
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
