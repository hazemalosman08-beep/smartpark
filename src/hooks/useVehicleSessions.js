import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "@/lib/localStore";
import { makeVehicleId, recommendFreeSpot, zoneOf } from "@/lib/vehicleSessions";

const SOURCE = "simulation";

// Phase 1: the vehicle-session database. Entry, parking confirmation and exit
// are simulated here — no camera detection is claimed.
export default function useVehicleSessions() {
  const [sessions, setSessions] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [log, setLog] = useState([]);
  const sessionsRef = useRef([]);
  const pendingRef = useRef(new Set());
  const writtenRef = useRef(new Map());
  const ingestingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [live, past] = await Promise.all([
        db.ParkingSession.filter(
          { status: "active" },
          { sort: "-entry_time", limit: 100 }
        ),
        db.ParkingSession.filter(
          { status: "closed" },
          { sort: "-exit_time", limit: 20 }
        ),
      ]);
      const next = [...(live.items || []), ...(past.items || [])];
      sessionsRef.current = next;
      setSessions(next);
      setError(null);
    } catch (err) {
      setError(err?.message || "Could not load vehicle sessions");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const enter = useCallback(
    async (spots = []) => {
      setBusy(true);
      setError(null);
      try {
        const live = sessions.filter((s) => s.status === "active");
        const vehicleId = makeVehicleId(sessions.map((s) => s.vehicle_id));
        const target = recommendFreeSpot(spots, live);
        const now = new Date().toISOString();

        const created = await db.ParkingSession.create({
          vehicle_id: vehicleId,
          status: "active",
          entry_time: now,
          last_seen_at: now,
          spot_label: target?.label || "",
          zone: target ? zoneOf(target.label) : "Entrance",
          location_status: target ? "estimated" : "unknown",
          confidence: target ? 0.62 : 0,
          source: SOURCE,
          camera: "ENTRY-CAM (simulated)",
        });

        const events = [
          {
            session_id: created.id,
            vehicle_id: vehicleId,
            type: "entry",
            zone: "Entrance",
            location_status: "confirmed",
            confidence: 0.94,
            camera: "ENTRY-CAM (simulated)",
            source: SOURCE,
            occurred_at: now,
            note: "Vehicle entered the facility",
          },
        ];
        if (target) {
          events.push({
            session_id: created.id,
            vehicle_id: vehicleId,
            type: "move",
            zone: zoneOf(target.label),
            spot_label: target.label,
            location_status: "estimated",
            confidence: 0.62,
            camera: "ROW-CAM (simulated)",
            source: SOURCE,
            occurred_at: now,
            note: `Guided to ${target.label}; parking not confirmed`,
          });
        }
        await db.VehicleEvent.bulkCreate(events);
        await load();
        return created;
      } catch (err) {
        setError(err?.message || "Could not start a vehicle session");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [sessions, load]
  );

  const confirm = useCallback(
    async (session) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      try {
        const now = new Date().toISOString();
        await db.ParkingSession.update(session.id, {
          location_status: "confirmed",
          confidence: 0.97,
          last_seen_at: now,
          zone: session.spot_label ? zoneOf(session.spot_label) : session.zone,
        });
        await db.VehicleEvent.create({
          session_id: session.id,
          vehicle_id: session.vehicle_id,
          type: "parked",
          zone: session.spot_label ? zoneOf(session.spot_label) : session.zone,
          spot_label: session.spot_label || "",
          location_status: "confirmed",
          confidence: 0.97,
          camera: "ROW-CAM (simulated)",
          source: SOURCE,
          occurred_at: now,
          note: session.spot_label
            ? `Parked in ${session.spot_label}`
            : "Parking confirmed without a mapped spot",
        });
        await load();
      } catch (err) {
        setError(err?.message || "Could not confirm the parking location");
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const exit = useCallback(
    async (session) => {
      if (!session) return;
      setBusy(true);
      setError(null);
      try {
        const now = new Date().toISOString();
        await db.ParkingSession.update(session.id, {
          status: "closed",
          exit_time: now,
          last_seen_at: now,
        });
        await db.VehicleEvent.create({
          session_id: session.id,
          vehicle_id: session.vehicle_id,
          type: "exit",
          zone: "Exit",
          spot_label: session.spot_label || "",
          location_status: "confirmed",
          confidence: 0.93,
          camera: "EXIT-CAM (simulated)",
          source: SOURCE,
          occurred_at: now,
          note: "Vehicle exited; session closed",
        });
        await load();
      } catch (err) {
        setError(err?.message || "Could not close the session");
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  // The camera tracker hands over the live tracks every few seconds: a new visual
  // ID opens a session, movement rewrites its last known position, and a vehicle
  // no camera can see any more closes it.
  const ingest = useCallback(async (nextTracks = [], events = []) => {
    setTracks(nextTracks);
    if (events.length) {
      setLog((prev) =>
        [
          ...events.map((event, index) => ({ ...event, key: `${event.occurred_at}-${index}` })),
          ...prev,
        ].slice(0, 14)
      );
    }
    if (ingestingRef.current) return;

    const known = new Map(
      sessionsRef.current
        .filter((s) => s.status === "active" && s.vehicle_id)
        .map((s) => [s.vehicle_id, s])
    );
    const closing = new Set(
      events.filter((e) => e.type === "exit" && e.vehicle_id).map((e) => e.vehicle_id)
    );
    const creates = [];
    const updates = [];

    for (const track of nextTracks) {
      const id = track.vehicle_id;
      if (!id || closing.has(id)) continue;
      const position = {
        zone: track.zone || "",
        spot_label: track.spot_label || "",
        location_status: track.status,
        confidence: track.confidence,
        camera: track.camera || "",
        last_seen_at: new Date(track.last_seen || Date.now()).toISOString(),
        position_x: Math.round(track.x + (track.w || 0) / 2),
        position_y: Math.round(track.y + (track.h || 0) / 2),
      };
      const existing = known.get(id);
      // A space the cameras once confirmed stays on the record, so the driver still
      // finds the car after it has driven off.
      if (!position.spot_label && existing?.spot_label) position.spot_label = existing.spot_label;
      if (!existing) {
        if (pendingRef.current.has(id) || writtenRef.current.has(id)) continue;
        pendingRef.current.add(id);
        creates.push({
          vehicle_id: id,
          status: "active",
          entry_time: new Date(track.first_seen || Date.now()).toISOString(),
          source: "camera",
          ...position,
        });
        continue;
      }
      const last = writtenRef.current.get(id) || {};
      const moved =
        Math.abs((last.x ?? -99) - position.position_x) > 2 ||
        Math.abs((last.y ?? -99) - position.position_y) > 2;
      if (
        last.status === position.location_status &&
        last.zone === position.zone &&
        last.spot === position.spot_label &&
        !moved
      ) {
        continue;
      }
      updates.push({ id: existing.id, ...position });
      writtenRef.current.set(id, {
        status: position.location_status,
        zone: position.zone,
        spot: position.spot_label,
        x: position.position_x,
        y: position.position_y,
      });
    }

    for (const id of closing) {
      const session = known.get(id);
      if (!session) continue;
      updates.push({ id: session.id, status: "closed", exit_time: new Date().toISOString() });
      writtenRef.current.delete(id);
    }

    // A camera session nothing has observed for ten minutes is over: leaving it
    // active would keep a vehicle on site that the cameras cannot see.
    const stillTracked = new Set(nextTracks.filter((t) => t.vehicle_id).map((t) => t.vehicle_id));
    for (const session of sessionsRef.current) {
      if (session.status !== "active" || session.source !== "camera") continue;
      if (stillTracked.has(session.vehicle_id)) continue;
      if (updates.some((change) => change.id === session.id)) continue;
      const seen = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
      if (!seen || Date.now() - seen < 10 * 60 * 1000) continue;
      updates.push({ id: session.id, status: "closed", exit_time: new Date().toISOString() });
      writtenRef.current.delete(session.vehicle_id);
    }

    if (!creates.length && !updates.length) return;

    ingestingRef.current = true;
    try {
      let created = [];
      if (creates.length) {
        created = await db.ParkingSession.bulkCreate(creates);
        created.forEach((record) => {
          pendingRef.current.delete(record.vehicle_id);
          writtenRef.current.set(record.vehicle_id, {
            status: record.location_status,
            zone: record.zone,
            spot: record.spot_label,
            x: record.position_x,
            y: record.position_y,
          });
        });
      }
      if (updates.length) await db.ParkingSession.bulkUpdate(updates);

      const idByVehicle = new Map([...known].map(([vehicle, session]) => [vehicle, session.id]));
      created.forEach((record) => idByVehicle.set(record.vehicle_id, record.id));
      const observations = events
        .filter((event) => event.vehicle_id && idByVehicle.has(event.vehicle_id))
        .map((event) => ({ ...event, session_id: idByVehicle.get(event.vehicle_id) }));
      if (observations.length) await db.VehicleEvent.bulkCreate(observations);

      setSessions((prev) => {
        const byId = new Map(prev.map((session) => [session.id, session]));
        created.forEach((record) => byId.set(record.id, record));
        updates.forEach((change) => {
          const session = byId.get(change.id);
          if (session) byId.set(change.id, { ...session, ...change });
        });
        sessionsRef.current = [...byId.values()];
        return sessionsRef.current;
      });
      setError(null);
    } catch (err) {
      pendingRef.current.clear();
      setError(err?.message || "Could not record the camera tracking update");
    } finally {
      ingestingRef.current = false;
    }
  }, []);

  // `extra` carries the IDs already handed out in the current beat, because
  // sessions and tracks only refresh after the render — without it every car
  // found in one scan would be given the same number.
  const assignVehicleId = useCallback(
    (extra = []) =>
      makeVehicleId([
        ...sessionsRef.current.map((s) => s.vehicle_id),
        ...tracks.map((t) => t.vehicle_id),
        ...extra,
      ].filter(Boolean)),
    [tracks]
  );

  return {
    sessions,
    active: sessions.filter((s) => s.status === "active"),
    closed: sessions.filter((s) => s.status === "closed"),
    ready,
    busy,
    error,
    tracks,
    log,
    enter,
    confirm,
    exit,
    ingest,
    assignVehicleId,
    reload: load,
  };
}