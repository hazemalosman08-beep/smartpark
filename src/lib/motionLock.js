import { makeFlowFrame, vehicleFeatures, vehicleFlow } from "@/lib/vehicleFlow";

// An unchanged vehicle keeps the ORIGINAL anchor, not a repeatedly refreshed
// template. Subpixel camera noise therefore cannot accumulate into box drift.
export function createLockState() {
  return { locks: new Map(), history: [] };
}

export function rememberFlowFrame(state, frame) {
  state.history.push(frame);
  while (state.history.length > 120 || state.history[0]?.at < frame.at - 10000) state.history.shift();
}

function advance(lock, frame) {
  const flow = vehicleFlow(lock.frame, frame, lock.points);
  if (!flow) return null;
  const moving = Math.hypot(flow.dx, flow.dy) >= 0.65;
  const box = moving ? {
    ...lock.box,
    x: lock.box.x + flow.dx / frame.w * 100,
    y: lock.box.y + flow.dy / frame.h * 100,
  } : lock.box;
  return {
    box, moving, quality: flow.quality,
    anchor: moving ? { ...lock, frame, box, points: vehicleFeatures(frame, box) } : lock,
  };
}

export function followTracks(state, { source, width, height, tracks = [], now = Date.now() } = {}) {
  if (!source || !width || !height) return tracks;
  const frame = makeFlowFrame(source, width, height, now);
  rememberFlowFrame(state, frame);
  const seen = new Set();
  const next = tracks.map((track) => {
    seen.add(track.key);
    let lock = state.locks.get(track.key);
    if (!lock || lock.revision !== (track.geometry_revision || 0)) {
      lock = { frame, box: { x: track.x, y: track.y, w: track.w, h: track.h }, points: vehicleFeatures(frame, track), revision: track.geometry_revision || 0 };
      state.locks.set(track.key, lock);
      return track;
    }
    const result = advance(lock, frame);
    if (!result) return { ...track, flow_ready: false, flow_lost_at: track.flow_lost_at || now };
    state.locks.set(track.key, result.anchor);
    return { ...track, ...result.box, stationary: !result.moving, flow_ready: true, flow_lost_at: 0, lock: result.quality, lock_at: now };
  });
  for (const key of state.locks.keys()) if (!seen.has(key)) state.locks.delete(key);
  return next;
}

// Detection completes AFTER its source frame was captured. Replay measured motion
// before using its boxes, rather than snapping a moving car back into the past.
export function reprojectCars(state, observation, cars, latest) {
  if (!cars.length) return [];
  if (latest.at - observation.at > 10000 || observation.w !== latest.w || observation.h !== latest.h) return [];
  const frames = [...state.history.filter((frame) => frame.at > observation.at && frame.at < latest.at), latest];
  return cars.flatMap((car) => {
    let lock = { frame: observation, box: car, points: vehicleFeatures(observation, car) };
    let previousAt = observation.at;
    for (const frame of frames) {
      if (frame.at - previousAt > 1200) return [];
      const result = advance(lock, frame);
      if (!result) return [];
      lock = result.anchor;
      previousAt = frame.at;
    }
    return [{ ...car, ...lock.box }];
  });
}