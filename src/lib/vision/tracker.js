// Multi-vehicle tracker (ByteTrack-style association + Kalman smoothing).
//
// Why this design:
//  * Kalman prediction carries each vehicle forward between frames, so matching
//    compares a detection with where the car SHOULD be now, not where it was.
//  * Two-stage matching: confident detections first, then weak detections may
//    only continue existing tracks (e.g. a car half-hidden behind a pillar keeps
//    its ID instead of blinking out). Weak detections never create new vehicles.
//  * Optimal (Hungarian) assignment for the whole frame, so two cars passing
//    each other can not swap IDs because of greedy matching.
//  * New tracks are tentative until seen in several frames, which removes
//    one-frame false positives before they ever get an ID.
//  * Parked vehicles that disappear (occlusion, missed detection) are held in
//    place much longer than moving ones.
import { center, dist, hungarian, iou } from "./geometry.js";

const DEFAULTS = {
  highScore: 0.45, // confident detection
  lowScore: 0.12, // weakest detection still used to continue a track
  newTrackScore: 0.5, // a new vehicle needs at least this
  confirmHits: 3, // frames before a tentative vehicle gets an ID
  confirmScore: 0.8, // ...or one this confident, seen twice
  lostMovingMs: 4000, // a moving vehicle out of sight this long is gone
  lostParkedMs: 90000, // a parked vehicle is held this long while hidden
  parkAfterMs: 6000, // still this long (inside a stall) = parked
  movingSpeed: 0.7, // m/s above which a vehicle is driving
  trailLength: 60,
};

// --- Kalman filter, constant velocity, one independent filter per coordinate ---
function kfInit(value) {
  return { x: value, v: 0, p00: 4, p01: 0, p11: 25 };
}
function kfPredict(f, dt, q) {
  f.x += f.v * dt;
  const p00 = f.p00 + dt * (2 * f.p01 + dt * f.p11) + q * dt * dt * dt / 3;
  const p01 = f.p01 + dt * f.p11 + q * dt * dt / 2;
  const p11 = f.p11 + q * dt;
  f.p00 = p00; f.p01 = p01; f.p11 = p11;
}
function kfUpdate(f, z, r) {
  const s = f.p00 + r;
  const k0 = f.p00 / s, k1 = f.p01 / s;
  const y = z - f.x;
  f.x += k0 * y; f.v += k1 * y;
  const p00 = (1 - k0) * f.p00, p01 = (1 - k0) * f.p01, p11 = f.p11 - k1 * f.p01;
  f.p00 = p00; f.p01 = p01; f.p11 = p11;
}

function boxOf(filters) {
  const [cx, cy, w, h] = filters.map((f) => f.x);
  return { x: cx - w / 2, y: cy - h / 2, w: Math.max(0.2, w), h: Math.max(0.2, h) };
}

// Matching cost between a predicted track box and a detection: 1 - IoU, with a
// distance fallback so a fast car at a low frame rate (no overlap) still matches.
function cost(trackBox, det) {
  const overlap = iou(trackBox, det);
  if (overlap > 0) return 1 - overlap;
  const diag = Math.hypot(trackBox.w, trackBox.h);
  const gap = dist(center(trackBox), center(det)) / Math.max(diag, 0.5);
  const sizeRatio = (det.w * det.h) / Math.max(1e-6, trackBox.w * trackBox.h);
  if (gap > 0.75 || sizeRatio < 0.4 || sizeRatio > 2.5) return Infinity;
  return 0.92 + gap * 0.1;
}

function associate(tracks, dets, maxCost) {
  if (!tracks.length || !dets.length) return { matches: [], tracksLeft: tracks.map((_, i) => i), detsLeft: dets.map((_, i) => i) };
  const big = 1e6;
  const costs = tracks.map((t) => dets.map((d) => {
    const c = cost(t.predicted, d);
    return Number.isFinite(c) ? c : big;
  }));
  const matches = hungarian(costs).filter(([r, c]) => costs[r][c] <= maxCost);
  const usedT = new Set(matches.map(([r]) => r));
  const usedD = new Set(matches.map(([, c]) => c));
  return {
    matches,
    tracksLeft: tracks.map((_, i) => i).filter((i) => !usedT.has(i)),
    detsLeft: dets.map((_, i) => i).filter((i) => !usedD.has(i)),
  };
}

export function createTracker(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let tracks = [];
  let nextKey = 1;
  let lastNow = 0;

  // Two vehicles may never share an ID, whatever the ID source returns.
  function uniqueId(env) {
    const taken = new Set(tracks.map((t) => t.vehicle_id).filter(Boolean));
    const requested = env.assignId?.([...taken]);
    if (requested && !taken.has(requested)) return requested;
    for (let n = 1; ; n += 1) {
      const id = `SP-${String(n).padStart(3, "0")}`;
      if (!taken.has(id)) return id;
    }
  }

  function reset() {
    tracks = [];
    lastNow = 0;
  }

  /**
   * One frame.
   * detections: [{x,y,w,h,score,label}] in % of the frame
   * env: {
   *   now, still (single photo), assignId(), toGround(box) -> {x,y} lot coords,
   *   metersPerUnit, locateAll(tracks) -> Map(track.key -> stall)  (one car per stall)
   * }
   */
  function update(detections = [], env = {}) {
    const now = env.now ?? Date.now();
    const still = Boolean(env.still);
    const mpu = env.metersPerUnit || 1;
    const toGround = env.toGround || ((b) => center(b));
    const dt = lastNow ? Math.min(3, Math.max(0.02, (now - lastNow) / 1000)) : 0.1;
    lastNow = now;
    const events = [];

    // 1. Predict.
    for (const t of tracks) {
      const size = Math.max(t.filters[2].x, t.filters[3].x);
      const q = t.motion === "parked" ? 0.002 * size : 0.25 * size;
      if (t.motion === "parked") { t.filters[0].v *= 0.5; t.filters[1].v *= 0.5; }
      t.filters.forEach((f, i) => kfPredict(f, dt, i < 2 ? q : q * 0.3));
      // Sizes do not drift on their own.
      t.filters[2].v *= 0.8; t.filters[3].v *= 0.8;
      t.predicted = boxOf(t.filters);
    }

    const dets = detections.filter((d) => d.w > 0 && d.h > 0 && (d.score ?? 1) >= cfg.lowScore);
    const high = dets.filter((d) => (d.score ?? 1) >= cfg.highScore);
    const low = dets.filter((d) => (d.score ?? 1) < cfg.highScore);
    const active = tracks.filter((t) => t.state !== "tentative");
    const tentative = tracks.filter((t) => t.state === "tentative");

    const matched = new Map(); // track -> detection
    // 2. Established vehicles against confident detections.
    const s1 = associate(active, high, 0.97);
    s1.matches.forEach(([ti, di]) => matched.set(active[ti], high[di]));
    // 3. Remaining established vehicles against weak detections (occlusion recovery).
    const remaining = s1.tracksLeft.map((i) => active[i]).filter((t) => t.state === "confirmed" || now - t.last_seen < 1500);
    const s2 = associate(remaining, low, 0.6);
    s2.matches.forEach(([ti, di]) => matched.set(remaining[ti], low[di]));
    // 4. Tentative vehicles against what is left of the confident detections.
    const highLeft = s1.detsLeft.map((i) => high[i]);
    const s3 = associate(tentative, highLeft, 0.8);
    s3.matches.forEach(([ti, di]) => matched.set(tentative[ti], highLeft[di]));
    const unusedHigh = s3.detsLeft.map((i) => highLeft[i]);

    // 5. Correct matched tracks.
    for (const [t, d] of matched) {
      const c = center(d);
      const size = Math.max(d.w, d.h);
      // Measurement noise: confident, large boxes are trusted more.
      const r = (0.02 * size) ** 2 / Math.max(0.2, d.score ?? 0.5) + 0.01;
      kfUpdate(t.filters[0], c.x, r);
      kfUpdate(t.filters[1], c.y, r);
      kfUpdate(t.filters[2], d.w, r * 4);
      kfUpdate(t.filters[3], d.h, r * 4);
      t.score = t.score * 0.7 + (d.score ?? 0.5) * 0.3;
      t.label = d.label || t.label;
      t.hits += 1;
      t.missed = 0;
      t.last_seen = now;
      if (t.state === "lost") t.state = "confirmed";
    }

    // 6. Promote tentative tracks.
    for (const t of tentative) {
      if (!matched.has(t)) continue;
      if (still || t.hits >= cfg.confirmHits || (t.hits >= 2 && t.score >= cfg.confirmScore)) {
        t.state = "confirmed";
        t.vehicle_id = uniqueId(env);
        t.confirmed_at = now;
        t.needsEntryEvent = true;
      }
    }

    // 7. Unmatched tracks.
    const survivors = [];
    for (const t of tracks) {
      if (matched.has(t)) { survivors.push(t); continue; }
      t.missed += 1;
      if (t.state === "tentative") continue; // never confirmed: drop silently
      t.state = "lost";
      const limit = t.motion === "parked" ? cfg.lostParkedMs : cfg.lostMovingMs;
      if (now - t.last_seen > limit) {
        events.push(eventFor(t, "exit", now, { status: "unknown", confidence: 0, note: t.motion === "parked" ? `Left ${t.spot_label || "its space"} — no longer visible` : "Left the camera view" }));
        continue;
      }
      survivors.push(t);
    }

    // 8. New vehicles.
    for (const d of unusedHigh) {
      if ((d.score ?? 1) < cfg.newTrackScore && !still) continue;
      // Never start a second vehicle on top of one that is already followed.
      if (survivors.some((t) => iou(t.predicted || boxOf(t.filters), d) > 0.6)) continue;
      const c = center(d);
      const t = {
        key: `t${nextKey++}`,
        filters: [kfInit(c.x), kfInit(c.y), kfInit(d.w), kfInit(d.h)],
        state: "tentative",
        vehicle_id: "",
        score: d.score ?? 0.5,
        label: d.label || "car",
        hits: 1,
        missed: 0,
        first_seen: now,
        last_seen: now,
        trail: [],
        motion: "moving",
        still_since: now,
        spot_label: "",
      };
      t.predicted = boxOf(t.filters);
      if (still) {
        t.state = "confirmed";
        t.vehicle_id = uniqueId(env);
        t.needsEntryEvent = true;
      }
      survivors.push(t);
    }
    tracks = survivors;

    // 9. Ground position, speed, motion state and stall for every vehicle.
    for (const t of tracks) Object.assign(t, boxOf(t.filters));
    // Stalls are decided for all vehicles together (one car per stall), not per car.
    const stallOf = env.locateAll ? env.locateAll(tracks.filter((t) => t.state !== "tentative")) : new Map();
    for (const t of tracks) {
      const box = { x: t.x, y: t.y, w: t.w, h: t.h };
      const ground = toGround(box);
      t.ground = ground;
      const c = center(box);
      if (t.state !== "lost") {
        t.trail.push({ x: ground.x, y: ground.y, cx: c.x, cy: c.y, t: now });
        if (t.trail.length > cfg.trailLength) t.trail.shift();
      }
      // Speed over the last ~1.5 s of ground positions (robust to jitter).
      const windowStart = t.trail.find((p) => now - p.t <= 1500) || t.trail[0];
      const elapsed = windowStart ? (now - windowStart.t) / 1000 : 0;
      // Movement must also be visible in the picture itself (a share of the car's
      // own size); far from the camera one pixel of jitter can be metres on the ground.
      const pictureMove = windowStart ? Math.hypot(c.x - windowStart.cx, c.y - windowStart.cy) / Math.max(0.5, Math.hypot(box.w, box.h)) : 0;
      const visiblyMoving = pictureMove > 0.12;
      t.speed = elapsed > 0.3 && visiblyMoving ? (dist(windowStart, ground) * mpu) / elapsed : elapsed > 0.3 ? 0 : t.speed || 0;
      if (elapsed > 0.3 && visiblyMoving && dist(windowStart, ground) * mpu > 0.4) t.heading = Math.atan2(ground.y - windowStart.y, ground.x - windowStart.x);
      // A different stall must be seen twice in a row before the car "moves" there,
      // so a car on a stall line does not flicker between two stalls.
      const seen = stallOf.get(t.key) || null;
      let stall = t.stall || null;
      if (still || (seen?.id || null) === (t.stall?.id || null)) { stall = seen; t.stallCandidate = null; }
      else if (t.stallCandidate && (t.stallCandidate.id || null) === (seen?.id || null)) { stall = seen; t.stallCandidate = null; }
      else t.stallCandidate = seen || { id: null };
      t.stall = stall;
      const previousMotion = t.motion;
      if (still) {
        t.motion = stall ? "parked" : "stopped";
      } else if (t.speed > cfg.movingSpeed) {
        t.motion = "moving";
        t.still_since = now;
      } else if (t.state !== "lost") {
        const stillFor = now - (t.still_since || now);
        t.motion = stillFor >= cfg.parkAfterMs && (stall || !env.hasStalls) ? "parked" : "stopped";
      }
      const previousSpot = t.spot_label;
      t.spot_label = t.motion === "parked" ? stall?.label || "" : "";
      t.zone = stall?.row ? `Row ${stall.row}` : env.zoneOf?.(ground) || "Lot";
      t.camera = env.camera || "CAM 1";
      t.confidence = Math.round(Math.min(0.99, t.score) * 100) / 100;
      t.status = t.state === "lost" ? (now - t.last_seen < 3000 ? "estimated" : "unknown") : t.state === "confirmed" ? "confirmed" : "estimated";
      t.velocity_x = t.filters[0].v;
      t.velocity_y = t.filters[1].v;

      if (!t.vehicle_id) continue;
      if (t.needsEntryEvent) {
        t.needsEntryEvent = false;
        events.push(eventFor(t, "entry", now, { note: still ? "Vehicle found in the captured frame" : `Vehicle detected — ID ${t.vehicle_id} assigned` }));
        t.last_event_at = now;
        t.last_event_ground = ground;
      } else if (t.motion === "parked" && t.spot_label && previousSpot !== t.spot_label) {
        events.push(eventFor(t, "parked", now, { note: `Parked in ${t.spot_label}` }));
        t.last_event_at = now;
        t.last_event_ground = ground;
      } else if (previousMotion === "parked" && t.motion === "moving") {
        events.push(eventFor(t, "move", now, { note: `Pulled out of ${previousSpot || "its space"}`, spot_label: previousSpot }));
        t.last_event_at = now;
        t.last_event_ground = ground;
      } else if (t.motion === "moving" && now - (t.last_event_at || 0) > 5000 && dist(t.last_event_ground || ground, ground) * mpu > 8) {
        events.push(eventFor(t, "move", now, { note: `Driving through ${t.zone}` }));
        t.last_event_at = now;
        t.last_event_ground = ground;
      }
    }

    return { tracks: snapshot(), events };
  }

  function snapshot() {
    return tracks
      .filter((t) => t.state !== "tentative")
      .map((t) => ({
        key: t.key,
        vehicle_id: t.vehicle_id,
        x: t.x, y: t.y, w: t.w, h: t.h,
        ground: t.ground,
        trail: t.trail.slice(-30),
        heading: t.heading ?? null,
        speed: Math.round((t.speed || 0) * 10) / 10,
        motion: t.motion,
        state: t.state,
        status: t.status,
        confidence: t.confidence,
        label: t.label,
        spot_label: t.spot_label,
        zone: t.zone,
        camera: t.camera,
        first_seen: t.first_seen,
        last_seen: t.last_seen,
        missed: t.state === "lost" ? t.missed : 0,
        velocity_x: t.velocity_x,
        velocity_y: t.velocity_y,
      }));
  }

  // Tentative tracks too (used by the camera overlay to show "acquiring" boxes).
  function pending() {
    return tracks.filter((t) => t.state === "tentative").map((t) => ({ key: t.key, x: t.x, y: t.y, w: t.w, h: t.h, score: t.score }));
  }

  // The camera->lot mapping changed: positions recorded in the old plan
  // coordinates are meaningless now (they would read as a huge jump).
  function clearTrails() {
    for (const t of tracks) { t.trail = []; t.speed = 0; t.heading = undefined; }
  }

  return { update, reset, pending, clearTrails, get size() { return tracks.length; } };
}

function eventFor(track, type, now, extra = {}) {
  const c = center(track);
  return {
    vehicle_id: track.vehicle_id,
    type,
    zone: extra.zone ?? track.zone ?? "",
    spot_label: extra.spot_label ?? track.spot_label ?? "",
    location_status: extra.status ?? track.status ?? "confirmed",
    confidence: extra.confidence ?? track.confidence ?? 0,
    camera: track.camera || "CAM 1",
    source: "camera",
    occurred_at: new Date(now).toISOString(),
    position_x: Math.round(c.x),
    position_y: Math.round(c.y),
    note: extra.note || "",
  };
}
