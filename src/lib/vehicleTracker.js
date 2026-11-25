import stableVehicleGeometry from "@/lib/stableVehicleGeometry";
import associateVehicles from "@/lib/vehicleAssociation";
import { makeVehicleId } from "@/lib/vehicleSessions";

// Temporary visual-ID tracking across camera zones.
//
// Every vehicle the detector finds in the lot is followed from frame to frame and
// keeps one temporary ID while it is the same object. The ID is a visual label,
// not a permanent identity: when a vehicle is hidden from every camera, or a
// handoff between two zones is not backed by overlapping views, the location
// drops to estimated or unknown instead of claiming a confirmed position.

const VEHICLE_SCORE = 0.25;
const DROP_AFTER = 8; // missed reads (~24s at a 3s beat) before the vehicle is gone
const PARKED_STEPS = 2; // consecutive still reads before parking is confirmed
const MOVE_DISTANCE = 10; // % of the frame that counts as driving somewhere
const MOVE_GAP_MS = 6000;
const CALM_SPEED = 2.5;
// A track nobody has seen for this long is not the same car any more: the feed was
// closed or a vehicle left the view long ago.
const STALE_MS = 60000;

const centreOf = (box) => ({
  x: (box.x ?? 0) + (box.w ?? 0) / 2,
  y: (box.y ?? 0) + (box.h ?? 0) / 2,
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const insideBox = (box, point) =>
  point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;

const boxesOverlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;



// A point can sit in more than one zone; the tightest one is the camera that is
// actually looking at it.
function zoneAt(zones, point) {
  if (!zones?.length) return null;
  const hits = zones.filter((zone) => insideBox(zone, point));
  if (!hits.length) return null;
  return [...hits].sort((a, b) => a.w * a.h - b.w * b.h)[0];
}

function zoneNamed(zones, name) {
  if (!zones?.length || !name) return null;
  return zones.find((zone) => zone.name === name) || null;
}

function cellAt(cells, point) {
  if (!cells?.length) return null;
  return (
    cells.find((cell) =>
      insideBox(
        { x: cell.x - cell.w / 2, y: cell.y - cell.h / 2, w: cell.w, h: cell.h },
        point
      )
    ) || null
  );
}

export function createTrackState() {
  return { tracks: [], nextId: 1 };
}

function eventFor(track, type, now, extra = {}) {
  return {
    vehicle_id: track.vehicle_id,
    type,
    zone: extra.zone ?? track.zone ?? "",
    spot_label: extra.spot_label ?? track.spot_label ?? "",
    location_status: extra.status ?? track.status ?? "unknown",
    confidence: extra.confidence ?? track.confidence ?? 0,
    camera: extra.camera ?? track.camera ?? "",
    source: "camera",
    occurred_at: new Date(now).toISOString(),
    position_x: extra.x ?? Math.round(track.x + (track.w || 0) / 2),
    position_y: extra.y ?? Math.round(track.y + (track.h || 0) / 2),
    note: extra.note ?? "",
  };
}

/**
 * One tracking beat. Feed it the vehicles the detector just found and it returns
 * the live tracks plus the observations worth recording.
 *
 * detections: [{ x, y, w, h, score }] in percentages of the camera frame
 * zones:      [{ name, camera, x, y, w, h }] camera coverage areas
 * cells:      [{ row, index, x, y, w, h }] the mapped parking spaces
 */
export function stepTracks(state, { detections = [], zones = [], cells = [], now = Date.now(), assignId, observedSources = ["yolo", "vision"], singleFrame = false } = {}) {
  const previous = (state?.tracks || []).filter(
    (track) => singleFrame || now - (track.last_seen || 0) <= STALE_MS
  );
  const cars = detections.filter((car) => (car.score ?? 1) >= VEHICLE_SCORE);
  const events = [];
  const issued = new Set(previous.map((track) => track.vehicle_id).filter(Boolean));
  const makeId = () => {
    const requested = assignId?.([...issued]);
    const id = requested && !issued.has(requested) ? requested : makeVehicleId([...issued]);
    issued.add(id);
    return id;
  };
  const { trackTaken, carTaken } = associateVehicles(previous, cars, now);

  const tracks = [];
  let nextId = state?.nextId || 1;

  previous.forEach((track, trackIndex) => {
    const pair = trackTaken.get(trackIndex);
    if (!pair) {
      // A local-only read says nothing about a vehicle found by supplemental vision.
      const observed = observedSources.includes(track.detector || "yolo");
      if (!observed && now - track.last_seen < 15000) { tracks.push(track); return; }
      if (!track.vehicle_id) return;
      const missed = (track.missed || 0) + 1;
      if (missed >= DROP_AFTER && now - track.last_seen >= 15000) {
        if (track.vehicle_id) {
          events.push(
            eventFor(track, "exit", now, {
              status: "unknown",
              confidence: 0,
              note: "No camera can see this vehicle — session closed",
            })
          );
        }
        return;
      }
      // A single missed recognition must not blink a parked car off and on.
      // Keep its ID and last position; explicitly mark the location estimated.
      tracks.push({
        ...track,
        missed,
        status: missed < 3 ? "estimated" : "unknown",
        confidence: Math.round((track.confidence || 0) * 0.85 * 100) / 100,
      });
      return;
    }

    const car = cars[pair.carIndex];
    const geometry = stableVehicleGeometry(track, car, singleFrame);
    const point = centreOf(geometry);
    const speed = distance(point, centreOf(track));
    const confidence = Math.max(
      0.3,
      Math.min(0.99, Math.round((car.score ?? 0.8) * (1 - pair.gap / 45) * 100) / 100)
    );

    const zone = zoneAt(zones, point);
    const zoneName = zone?.name || track.zone || "LOT 1";
    const camera = zone?.camera || track.camera || "CAM 1";

    let status = "confirmed";
    let note = "";
    if (zoneName !== track.zone && track.zone) {
      const from = zoneNamed(zones, track.zone);
      const supported = from && zone && boxesOverlap(from, zone);
      status = supported ? "confirmed" : "estimated";
      note = supported
        ? `Handoff ${track.zone} → ${zoneName} (overlapping views)`
        : `Handoff ${track.zone} → ${zoneName} without overlapping views — estimated`;
    }

    const calm = speed < CALM_SPEED ? (track.calm || 0) + 1 : 0;
    const cell = cellAt(cells, point);
    const parked = Boolean(cell) && calm >= PARKED_STEPS;
    const spotLabel = parked ? `${cell.row}${cell.index}` : "";

    const detector = car.detector || track.detector || "yolo";
    const observedAt = car.observed_at || now;
    const freshEvidence = observedAt > (track.source_observations?.[detector] || 0);
    const hits = (track.hits || 0) + (freshEvidence ? 1 : 0);
    const strongHits = (track.strong_hits || 0) + (freshEvidence && (car.score ?? 1) >= (detector === "vision" ? 0.6 : 0.35) ? 1 : 0);
    const vehicleId = track.vehicle_id || (strongHits >= 2 || (car.score ?? 0) >= 0.65 ? makeId() : "");
    if (strongHits < 2 && !singleFrame) status = "estimated";
    const lastEventAt = track.last_event_at || 0;
    const movedFromEvent = distance(point, {
      x: track.last_event_x ?? point.x,
      y: track.last_event_y ?? point.y,
    });

    const next = {
      ...track,
      ...geometry,
      key: track.key,
      vehicle_id: vehicleId,
      detector,
      strong_hits: strongHits,
      source_observations: { ...track.source_observations, [detector]: observedAt },
      appearance: car.appearance || track.appearance,
      observed_at: observedAt,
      last_detection: { x: car.x, y: car.y, w: car.w, h: car.h },
      velocity_x: (centreOf(car).x - centreOf(track.last_detection || track).x) / Math.max(1, (observedAt - (track.observed_at || track.last_seen)) / 1000),
      velocity_y: (centreOf(car).y - centreOf(track.last_detection || track).y) / Math.max(1, (observedAt - (track.observed_at || track.last_seen)) / 1000),
      zone: zoneName,
      camera,
      status,
      confidence,
      spot_label: spotLabel || (parked ? track.spot_label || "" : ""),
      calm,
      hits,
      missed: 0,
      lock: track.lock || 0,
      lock_at: track.lock_at || 0,
      first_seen: track.first_seen || now,
      last_seen: now,
      last_event_at: lastEventAt,
      last_event_x: track.last_event_x ?? point.x,
      last_event_y: track.last_event_y ?? point.y,
    };

    if (vehicleId && !track.vehicle_id) {
      events.push(
        eventFor(next, "entry", now, {
          status,
          note: `Entered the lot — temporary visual ID ${vehicleId} assigned in ${zoneName}`,
        })
      );
      next.last_event_at = now;
      next.last_event_x = point.x;
      next.last_event_y = point.y;
    } else if (vehicleId && parked && track.spot_label !== spotLabel) {
      events.push(
        eventFor(next, "parked", now, {
          status,
          spot_label: spotLabel,
          note: `Parked in ${spotLabel} (${zoneName}, ${camera})`,
        })
      );
      next.last_event_at = now;
      next.last_event_x = point.x;
      next.last_event_y = point.y;
    } else if (
      vehicleId &&
      (note || (movedFromEvent >= MOVE_DISTANCE && now - lastEventAt >= MOVE_GAP_MS))
    ) {
      events.push(
        eventFor(next, "move", now, {
          status,
          note: note || `Driving through ${zoneName} (${camera})`,
        })
      );
      next.last_event_at = now;
      next.last_event_x = point.x;
      next.last_event_y = point.y;
    }

    tracks.push(next);
  });

  // Every accepted vehicle gets a temporary ID now. Certainty is still shown
  // as estimated until a later independent observation confirms its location.
  cars.forEach((car, carIndex) => {
    if (carTaken.has(carIndex)) return;
    const point = centreOf(car);
    const zone = zoneAt(zones, point);
    const cell = cellAt(cells, point);
    const created = {
      key: `t${nextId++}`,
      vehicle_id: makeId(),
      detector: car.detector || "yolo",
      geometry_detector: car.detector || "yolo",
      appearance: car.appearance,
      observed_at: car.observed_at || now,
      last_detection: { x: car.x, y: car.y, w: car.w, h: car.h },
      velocity_x: 0,
      velocity_y: 0,
      source_observations: { [car.detector || "yolo"]: car.observed_at || now },
      strong_hits: (car.score ?? 1) >= (car.detector === "vision" ? 0.6 : 0.35) ? 1 : 0,
      x: car.x,
      y: car.y,
      w: car.w,
      h: car.h,
      zone: zone?.name || "LOT 1",
      camera: zone?.camera || "CAM 1",
      status: singleFrame ? "confirmed" : "estimated",
      confidence: Math.round((car.score ?? 0.8) * 100) / 100,
      spot_label: cell ? `${cell.row}${cell.index}` : "",
      calm: 0,
      hits: 1,
      missed: 0,
      first_seen: now,
      last_seen: now,
      last_event_at: now,
      last_event_x: point.x,
      last_event_y: point.y,
    };
    tracks.push(created);
    if (created.vehicle_id) events.push(eventFor(created, "entry", now, { status: created.status, note: singleFrame ? "Vehicle observed in a captured frame" : "Vehicle observed; location awaiting another independent observation" }));
  });

  return { state: { tracks, nextId }, tracks, events };
}