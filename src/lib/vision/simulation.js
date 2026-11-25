// Traffic simulation on the real lot plan: cars enter at the entrance, drive the
// drawn lanes to a free stall, pull in, stay a while, back out and leave by the
// exit. Used when no camera is running, so the plan can be explored and demoed.
import { dist } from "./geometry.js";
import { routeBetween, routeToStall } from "./lot.js";
import { makeVehicleId } from "../vehicleSessions.js";

const COLORS = ["#e5e7eb", "#9ca3af", "#1f2937", "#dc2626", "#2563eb", "#f59e0b", "#10b981", "#7c3aed", "#78350f", "#0f172a"];

/**
 * seed:  Map(stallId -> { vehicle_id, color }) — the cars really parked right now
 *        (from the camera). They stay put, so the plan matches the real lot,
 *        and only new arrivals are animated. Without a seed the lot is filled at
 *        random.
 * rank:  (stall) -> cost. Guided arrivals take the cheapest free stall (the
 *        same "best space" the guide recommends). Without it, drivers pick one
 *        of the nearest few.
 */
export function createSimulation(lot, graph, { fill = 0.55, arrivalsPerMinute = 6, seed = null, rank = null } = {}) {
  const agents = [];
  const reserved = new Set();
  let issued = [];
  let spawnTimer = 0;
  let key = 1;
  const unitsPerMeter = 1 / (lot.metersPerUnit || 1);
  const cruise = 4.5 * unitsPerMeter; // ~16 km/h
  const crawl = 1.2 * unitsPerMeter;

  const nextId = () => {
    const id = makeVehicleId(issued);
    issued = [...issued, id].slice(-900);
    return id;
  };

  function park(stall, dwell, real = null) {
    const agent = {
      key: `sim${key++}`,
      vehicle_id: real?.vehicle_id || nextId(),
      color: real?.color || COLORS[Math.floor(Math.random() * COLORS.length)],
      real: Boolean(real),
      phase: "parked",
      stall,
      pos: { ...stall.centroid },
      heading: stall.heading,
      path: [],
      seg: 0,
      dwell,
      speed: 0,
      trail: [],
      first_seen: Date.now(),
    };
    reserved.add(stall.id);
    agents.push(agent);
  }

  if (seed) {
    issued = [...seed.values()].map((v) => v.vehicle_id).filter(Boolean);
    lot.stalls.forEach((stall) => {
      const real = seed.get(stall.id);
      if (real) park(stall, Infinity, real);
    });
  } else {
    lot.stalls.forEach((stall) => {
      if (Math.random() < fill) park(stall, 15 + Math.random() * 90);
    });
  }

  function pickStall() {
    const free = lot.stalls.filter((s) => !reserved.has(s.id));
    if (!free.length || !lot.entrance) return null;
    if (rank) return free.reduce((best, s) => (rank(s) < rank(best) ? s : best));
    // Drivers mostly take one of the closest few free stalls.
    const ranked = free
      .map((s) => ({ s, d: dist(lot.entrance, s.centroid) + Math.random() * lot.width * 0.15 }))
      .sort((a, b) => a.d - b.d);
    return ranked[Math.floor(Math.random() * Math.min(4, ranked.length))].s;
  }

  function spawn(events, now) {
    const stall = pickStall();
    if (!stall) return;
    reserved.add(stall.id);
    const path = routeToStall(lot, graph, stall);
    if (path.length < 2) return;
    const agent = {
      key: `sim${key++}`,
      vehicle_id: nextId(),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      phase: "arriving",
      guided: Boolean(rank),
      stall,
      pos: { ...path[0] },
      heading: Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x),
      path,
      seg: 0,
      speed: cruise,
      trail: [],
      first_seen: now,
    };
    agents.push(agent);
    events.push(event(agent, "entry", now, `Entered — heading for ${stall.label}`));
  }

  function leave(agent, events, now) {
    const s = agent.stall;
    const aisle = { x: s.front.x + (s.front.x - s.back.x) * 0.45, y: s.front.y + (s.front.y - s.back.y) * 0.45 };
    const target = lot.exit || lot.entrance;
    const out = routeBetween(graph, aisle, target);
    agent.path = [{ ...s.centroid }, aisle, ...out.slice(1)];
    agent.seg = 0;
    agent.reverseUntil = 1; // back out of the stall
    agent.phase = "leaving";
    reserved.delete(s.id);
    events.push(event(agent, "move", now, `Pulling out of ${s.label}`));
  }

  function step(dtSeconds, now = Date.now()) {
    const dt = Math.min(0.5, dtSeconds);
    const events = [];
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = (60 / arrivalsPerMinute) * (0.4 + Math.random() * 1.2);
      if (agents.filter((a) => a.phase === "arriving").length < 4) spawn(events, now);
    }
    for (let i = agents.length - 1; i >= 0; i -= 1) {
      const a = agents[i];
      if (a.phase === "parked") {
        a.dwell -= dt;
        a.speed = 0;
        if (a.dwell <= 0) leave(a, events, now);
        continue;
      }
      const target = a.path[a.seg + 1];
      if (!target) {
        if (a.phase === "arriving") {
          a.phase = "parked";
          a.dwell = 25 + Math.random() * 100;
          a.pos = { ...a.stall.centroid };
          a.heading = a.stall.heading;
          events.push(event(a, "parked", now, `Parked in ${a.stall.label}`));
        } else {
          events.push(event(a, "exit", now, "Left the lot"));
          agents.splice(i, 1);
        }
        continue;
      }
      // Slow down for the last segments (turning into / out of a stall).
      const remainingSegs = a.path.length - 1 - a.seg;
      const slow = (a.phase === "arriving" && remainingSegs <= 2) || (a.phase === "leaving" && a.seg <= (a.reverseUntil ?? -1));
      const desired = slow ? crawl : cruise;
      a.speed += Math.sign(desired - a.speed) * Math.min(Math.abs(desired - a.speed), 3 * unitsPerMeter * dt);
      // Keep a gap behind the car ahead on the same heading.
      const ahead = agents.find((o) => o !== a && o.phase !== "parked" && dist(o.pos, a.pos) < 6 * unitsPerMeter &&
        Math.cos(Math.atan2(o.pos.y - a.pos.y, o.pos.x - a.pos.x) - a.heading) > 0.8);
      const move = ahead ? Math.min(a.speed * dt, 0.2 * unitsPerMeter * dt) : a.speed * dt;
      const d = dist(a.pos, target);
      const reversing = a.phase === "leaving" && a.seg < (a.reverseUntil ?? 0);
      if (move >= d) {
        a.pos = { ...target };
        a.seg += 1;
      } else {
        a.pos = { x: a.pos.x + ((target.x - a.pos.x) / d) * move, y: a.pos.y + ((target.y - a.pos.y) / d) * move };
      }
      const dir = Math.atan2(target.y - a.pos.y, target.x - a.pos.x);
      if (d > 1e-3) {
        const want = reversing ? dir + Math.PI : dir;
        let diff = ((want - a.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        a.heading += diff * Math.min(1, dt * 5);
      }
      a.trail.push({ x: a.pos.x, y: a.pos.y, t: now });
      if (a.trail.length > 40) a.trail.shift();
    }
    return events;
  }

  function tracks() {
    return agents.map((a) => ({
      key: a.key,
      vehicle_id: a.vehicle_id,
      ground: a.pos,
      heading: a.heading,
      color: a.color,
      motion: a.phase === "parked" ? "parked" : "moving",
      phase: a.phase,
      speed: Math.round(a.speed * (lot.metersPerUnit || 1) * 10) / 10,
      spot_label: a.phase === "parked" ? a.stall.label : "",
      target_label: a.phase === "arriving" ? a.stall.label : "",
      real: a.real,
      route: a.phase === "arriving" ? [a.pos, ...a.path.slice(a.seg + 1)] : null,
      status: "confirmed",
      confidence: 1,
      trail: a.trail.slice(-25),
      first_seen: a.first_seen,
      zone: `Row ${a.stall.row}`,
    }));
  }

  function statuses() {
    const map = new Map();
    lot.stalls.forEach((s) => map.set(s.id, { status: "free", confidence: 1, vehicle_id: "" }));
    agents.forEach((a) => {
      if (a.phase === "parked") map.set(a.stall.id, { status: "occupied", confidence: 1, vehicle_id: a.vehicle_id });
    });
    return map;
  }

  function addCar(now = Date.now()) {
    const events = [];
    spawn(events, now);
    return events;
  }

  function removeCar(now = Date.now()) {
    const parked = agents.filter((a) => a.phase === "parked" && !a.real);
    if (!parked.length) return [];
    const events = [];
    leave(parked[Math.floor(Math.random() * parked.length)], events, now);
    return events;
  }

  return {
    step, tracks, statuses, addCar, removeCar,
    setRate: (perMinute) => { arrivalsPerMinute = Math.max(0.5, perMinute); },
  };
}

function event(agent, type, now, note) {
  return {
    vehicle_id: agent.vehicle_id,
    type,
    zone: `Row ${agent.stall.row}`,
    spot_label: agent.stall.label,
    location_status: "confirmed",
    confidence: 1,
    camera: "SIM",
    source: "simulation",
    occurred_at: new Date(now).toISOString(),
    note,
  };
}
