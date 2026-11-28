import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Building2, Car, Crosshair, FileUp, Footprints, Loader2, Lock, MapPin, Moon, Search, Sun, X } from "lucide-react";
import { ATTRIBUTION, buildingCounts, destinations, fetchArea, limitBounds, nearestParking, parkingSummary, parseOsm, searchDestinations, searchPlaces } from "@/lib/osm";
import { CampusScene } from "@/lib/three/campusScene";
import { LEVEL_COLOR, createSimulation, occupancyLevel } from "@/lib/occupancySim";
import { STATES, stateByCode } from "@/lib/usStates";

// Farther than this (about 10 minutes on foot) is not a real recommendation.
const FAR_WALK_M = 800;

function StepDot({ n, active = false, done = false }) {
  return <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-sky-500/30 text-sky-100" : active ? "bg-amber-400 text-neutral-900" : "bg-neutral-700 text-neutral-300"}`}>{n}</span>;
}

// Closest parking; with occupancy data, full lots go to the end.
function rankParking(osm, building, permit, occ) {
  const all = nearestParking(osm, building, 8, { permit });
  const full = (o) => occ?.get(o.lot.id)?.free === 0;
  // Usable lots with space, then usable but full, then lots the driver may not use.
  const rank = (o) => (!o.allowed ? 2 : full(o) ? 1 : 0);
  return all.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o).slice(0, 5);
}

function FreeBadge({ o, className = "" }) {
  if (!o) return null;
  const level = occupancyLevel(o);
  return <span className={`font-semibold tabular-nums ${className}`} style={{ color: LEVEL_COLOR[level] }}>{o.free ? `${o.free} free` : "Full"}</span>;
}

// A whole complex in 3D from OpenStreetMap: find it by name, see every
// building, road and parking lot. (Occupancy from cameras comes on top later.)
// The complex stays while switching tabs, but not after the app is reloaded
// or reopened (it then starts clean).
let visitOsm = null;

export default function CampusView() {
  const canvasRef = useRef(null);
  const engine = useRef(null);
  const fileRef = useRef(null);
  const [query, setQuery] = useState(() => visitOsm?.name || "");
  const [places, setPlaces] = useState([]); // suggestions while typing
  const [placesOpen, setPlacesOpen] = useState(false);
  const [placesBusy, setPlacesBusy] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [osm, setOsm] = useState(() => visitOsm);
  const placesFor = useRef(""); // the text (and state) the shown suggestions are for
  // Search only in one state (remembered on this device; "" = anywhere).
  const [stateCode, setStateCode] = useState(() => { try { return localStorage.getItem("smartpark.state") || ""; } catch { return ""; } });
  const searchState = stateByCode(stateCode);
  const [picked, setPicked] = useState(null);
  const [theme, setTheme] = useState("dark");
  // "Where are you going?"
  const [goText, setGoText] = useState("");
  const [goOpen, setGoOpen] = useState(false);
  const [trip, setTrip] = useState(null); // { building, options, chosen }
  const [permit, setPermit] = useState(() => { try { return localStorage.getItem("smartpark.permit") === "1"; } catch { return false; } });
  // Preview of live camera data with made-up numbers (clearly labelled).
  const [simOn, setSimOn] = useState(false);
  const [occ, setOcc] = useState(null); // Map lot id -> { free, total, estimated, trend }
  const [occAt, setOccAt] = useState(0);
  const occRef = useRef(null);
  occRef.current = occ;

  useEffect(() => {
    const e = new CampusScene(canvasRef.current, { onPick: setPicked });
    engine.current = e;
    const parent = canvasRef.current.parentElement;
    const ro = new ResizeObserver(() => e.resize(parent.clientWidth, parent.clientHeight));
    ro.observe(parent);
    e.resize(parent.clientWidth, parent.clientHeight);
    e.start();
    return () => { ro.disconnect(); e.dispose(); };
  }, []);
  useEffect(() => { if (osm) { engine.current?.setData(osm); setTrip(null); setGoText(""); } }, [osm]);
  useEffect(() => { engine.current?.setTrip(trip, { fly: trip?.fly !== false }); }, [trip]);
  useEffect(() => { if (engine.current) engine.current.onPickTrip = (o) => setTrip((t) => (t ? { ...t, chosen: o, fly: false } : t)); }, []);
  // Changing the permit switch re-ranks the current trip.
  useEffect(() => {
    try { localStorage.setItem("smartpark.permit", permit ? "1" : "0"); } catch { /* blocked */ }
    setTrip((t) => { if (!t || !osm) return t; const options = rankParking(osm, t.building, permit, occRef.current); return { ...t, options, chosen: options[0] || null }; });
  }, [permit, osm, simOn]);
  // The simulation: new numbers every few seconds while the preview is on.
  useEffect(() => {
    if (!simOn || !osm) { setOcc(null); return undefined; }
    let seed = 7;
    for (const ch of osm.name || "") seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const sim = createSimulation(osm, { seed });
    const tick = () => { setOcc(sim.snapshot()); setOccAt(Date.now()); };
    tick();
    const id = setInterval(() => { sim.step(); tick(); }, 4000);
    return () => clearInterval(id);
  }, [simOn, osm]);
  useEffect(() => { engine.current?.setOccupancy(occ); }, [occ]);
  const occTotals = useMemo(() => {
    if (!occ) return null;
    let free = 0, total = 0, estimated = 0;
    for (const o of occ.values()) { free += o.free; total += o.total; if (o.estimated) estimated += 1; }
    return { free, total, estimated, lots: occ.size };
  }, [occ]);
  const buildingsList = useMemo(() => (osm ? destinations(osm) : []), [osm]);
  const suggestions = useMemo(() => searchDestinations(buildingsList, goText), [buildingsList, goText]);
  const goTo = (building) => {
    const options = rankParking(osm, building, permit, occRef.current);
    setTrip({ building, options, chosen: options[0] || null });
    setGoText(building.name);
    setGoOpen(false);
    setPicked(null);
  };
  useEffect(() => { engine.current?.setTheme(theme); }, [theme]);

  const keep = (data) => { visitOsm = data; setOsm(data); setPicked(null); };

  // Suggestions as you type (after a short pause, newest answer wins).
  useEffect(() => {
    if (!typed.current) return undefined;
    const q = query.trim();
    if (q.length < 2) { setPlaces([]); return undefined; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setPlacesBusy(true);
      try {
        const near = osm?.bounds ? { lat: (osm.bounds.minlat + osm.bounds.maxlat) / 2, lon: (osm.bounds.minlon + osm.bounds.maxlon) / 2 } : null;
        const found = await searchPlaces(q, { signal: ctl.signal, near, state: searchState });
        setPlaces(found); placesFor.current = `${q}|${stateCode}`; setActive(0); setPlacesOpen(true); setError("");
      } catch (err) {
        if (err?.name !== "AbortError") setError(navigator.onLine === false ? "You are offline." : "Place search is not reachable right now. Try again in a moment.");
      }
      setPlacesBusy(false);
    }, 280);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query, stateCode]);
  useEffect(() => { try { localStorage.setItem("smartpark.state", stateCode); } catch { /* blocked */ } }, [stateCode]);

  const load = async (place) => {
    setPlacesOpen(false); setError("");
    typed.current = false;
    setQuery(place.name);
    const { bounds, limited } = limitBounds(place.bounds);
    setBusy(`Downloading ${place.name}…`);
    try {
      const data = await fetchArea(bounds, { onStatus: setBusy, outlineOf: place.osm });
      if (!data.buildings.length && !data.parking.length && !data.roads.length) throw new Error("OpenStreetMap has no buildings or roads mapped here yet.");
      keep({ ...data, name: place.name, detail: place.detail, limited });
    } catch (err) {
      setError(err?.message && !/fetch/i.test(err.message) ? err.message : "The map servers are busy right now. Try again in a minute.");
    }
    setBusy("");
  };
  const search = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    // Suggestions still for an earlier, shorter text (Enter pressed before
    // they caught up): search the whole text now instead.
    if (placesFor.current !== `${q}|${stateCode}` && q.length >= 2) {
      setPlacesBusy(true);
      try {
        const found = await searchPlaces(q, { state: searchState });
        placesFor.current = `${q}|${stateCode}`;
        setPlaces(found);
        if (found[0]) load(found[0]); else setError(`Nothing found for "${q}".`);
      } catch {
        setError("Place search is not reachable right now. Try again in a moment.");
      }
      setPlacesBusy(false);
      return;
    }
    if (places[active]) load(places[active]);
  };
  // An Overpass JSON file (e.g. exported from overpass-turbo.eu).
  const openFile = async (file, name = null) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const pts = (data.elements || []).flatMap((el) => el.geometry || (el.lat ? [el] : []) || []).filter((g) => g && Number.isFinite(g.lat));
      if (!pts.length) throw new Error("No map data in this file");
      const bounds = { minlat: Math.min(...pts.map((g) => g.lat)), maxlat: Math.max(...pts.map((g) => g.lat)), minlon: Math.min(...pts.map((g) => g.lon)), maxlon: Math.max(...pts.map((g) => g.lon)) };
      keep({ ...parseOsm(data, bounds, { outline: data.outline }), bounds, name: name || file.name.replace(/\.json$/i, ""), fetchedAt: new Date().toISOString() });
    } catch (err) { setError(err.message || "Could not read the file"); }
  };

  const summary = useMemo(() => (osm ? parkingSummary(osm) : null), [osm]);
  const counts = useMemo(() => (osm ? buildingCounts(osm) : null), [osm]);
  const lots = useMemo(() => (osm ? osm.parking.filter((p) => !p.space).sort((a, b) => ((a.inComplex === false) - (b.inComplex === false)) || (!a.name - !b.name) || (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }) || (b.capacity || 0) - (a.capacity || 0)) : []), [osm]);

  return (
    <div className="flex flex-1 flex-col gap-3 p-3 lg:flex-row lg:items-start lg:p-4">
      <aside className="flex min-h-0 flex-col gap-3 lg:w-[330px] lg:shrink-0">
        <p className="-mb-1 flex items-center gap-2 px-1 text-xs font-semibold text-sky-200"><StepDot n={1} active={!osm} done={Boolean(osm)} /> Find the place</p>
        <form onSubmit={search} className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => { typed.current = true; setQuery(e.target.value); }}
            onFocus={() => places.length && setPlacesOpen(true)}
            onBlur={() => setTimeout(() => setPlacesOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(places.length - 1, a + 1)); setPlacesOpen(true); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === "Escape") setPlacesOpen(false);
            }}
            placeholder={searchState ? `Search in ${searchState.name}…` : "Search a university, hospital, stadium, address…"}
            aria-label="Search a place"
            className="w-full rounded-full border border-neutral-700 bg-neutral-900 py-2.5 pl-8 pr-9 text-sm text-white shadow-sm focus:border-sky-500 focus:outline-none"
          />
          {placesBusy && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-neutral-400" />}
          {placesOpen && places.length > 0 && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl" role="listbox">
              {places.map((p, i) => (
                <button type="button" key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => load(p)} onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-start gap-2.5 px-3 py-2 text-left ${i === active ? "bg-white/10" : ""}`}>
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white">{p.name}</span>
                    <span className="block text-[11px] leading-snug text-neutral-400">{p.detail}</span>
                    {p.kind && <span className="block text-[10px] uppercase tracking-wider text-neutral-500">{p.kind}</span>}
                  </span>
                </button>
              ))}
              <p className="border-t border-neutral-800 px-3 py-1 text-[10px] text-neutral-500">Search by Photon · © OpenStreetMap contributors</p>
            </div>
          )}
          {placesOpen && !placesBusy && query.trim().length >= 2 && places.length === 0 && typed.current && (
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-400">No places found{searchState ? ` in ${searchState.name}` : ""}</div>
          )}
        </form>
        <label className="-mt-1 flex items-center gap-2 px-1 text-xs text-neutral-400">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-300" /> Search in
          <select value={stateCode} onChange={(e) => { setStateCode(e.target.value); typed.current = true; }} aria-label="Search only in this state"
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none">
            <option value="">All states</option>
            {STATES.map((st) => <option key={st.code} value={st.code}>{st.name}</option>)}
          </select>
        </label>
        {busy && <p className="flex items-center gap-2 text-sm text-sky-200"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</p>}
        {error && <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        {osm?.limited && <p className="text-[11px] text-amber-200/80">This place is large: the middle 3 × 3 km are shown.</p>}
        {(!osm || busy) && (
          <section aria-disabled="true" className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 opacity-70">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-400"><StepDot n={2} /> Where are you going? <Lock className="ml-auto h-3.5 w-3.5" /></p>
            <input disabled placeholder={busy ? "Loading the place…" : "Find the place first (step 1)"} aria-label="Where are you going (find the place first)"
              className="w-full cursor-not-allowed rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-sm text-neutral-500 placeholder:text-neutral-500" />
          </section>
        )}
        {osm && !busy && (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-100"><StepDot n={2} active /> Where are you going?</p>
            <div className="relative">
              <input
                value={goText}
                onChange={(e) => { setGoText(e.target.value); setGoOpen(true); }}
                onFocus={() => setGoOpen(true)}
                onKeyDown={(e) => { if (e.key === "Enter" && suggestions[0]) goTo(suggestions[0]); if (e.key === "Escape") setGoOpen(false); }}
                placeholder={buildingsList.length ? "Building name or address" : "No named buildings on this map"}
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-2 pr-8 text-sm text-white"
              />
              {goText && <button onClick={() => { setGoText(""); setTrip(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white" aria-label="Clear"><X className="h-4 w-4" /></button>}
              {goOpen && suggestions.length > 0 && goText !== trip?.building?.name && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-xl">
                  {suggestions.map((d) => (
                    <button key={d.id} onClick={() => goTo(d)} className="block w-full px-2.5 py-1.5 text-left text-sm text-neutral-200 hover:bg-white/10">
                      <span className="block truncate">{d.name}</span>
                      {(d.byAddress || d.inComplex === false || (d.address && d.address !== d.name)) && (
                        <span className="block truncate text-[11px] text-neutral-500">{[d.byAddress ? "Unnamed building" : d.address, d.inComplex === false ? `outside ${osm.name || "the complex"}` : ""].filter(Boolean).join(" · ")}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {trip && !trip.options.some((o) => o.allowed !== false && o.walkMeters <= FAR_WALK_M) && (
              <p className="mt-3 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100 ring-1 ring-amber-400/30">
                <b>No mapped parking lot within a 10-minute walk</b> of {trip.building.name}.
                {trip.options[0] ? ` The closest mapped lot is ${trip.options[0].walkMeters >= 1000 ? `${(trip.options[0].walkMeters / 1000).toFixed(1)} km` : `${trip.options[0].walkMeters} m`} away.` : ""} OpenStreetMap has few lots mapped here; street parking near the building is not in the data.
              </p>
            )}
            {trip && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-500">Closest parking</p>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-300">
                    <input type="checkbox" checked={permit} onChange={(e) => setPermit(e.target.checked)} className="h-3.5 w-3.5 accent-amber-400" /> I have a parking permit
                  </label>
                </div>
                {trip.options.map((o, i) => (
                  <button key={o.lot.id} onClick={() => setTrip({ ...trip, chosen: o, fly: true })}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ring-1 ${o === trip.chosen ? "bg-green-500/15 text-white ring-green-400/50" : "text-neutral-200 ring-white/5 hover:bg-white/5"}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${o === trip.chosen ? "bg-green-500 text-white" : "bg-white/10"}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-medium ${o.allowed === false ? "text-neutral-400" : ""}`}>{o.lot.name || (/multi/.test(o.lot.kind) ? "Parking structure" : "Unnamed lot")}</span>
                      <span className="block text-[11px] text-neutral-400">
                        {/multi|underground/.test(o.lot.kind) ? "Garage" : "Surface lot"}{o.lot.point ? " · mapped as a point" : ""}{o.lot.capacity ? ` · ${o.lot.capacity} spaces` : ""}{o.private ? (o.allowed ? " · permit holders" : " · private") : o.permitOnly ? " · permit only" : o.customers ? " · visitors" : o.lot.access && !/^(yes|public)$/.test(o.lot.access) ? ` · ${o.lot.access}` : ""}{o.lot.fee === "yes" ? " · paid" : ""}
                      </span>
                      {occ?.get(o.lot.id) && <FreeBadge o={occ.get(o.lot.id)} className="block text-xs" />}
                    </span>
                    <span className="shrink-0 text-right text-xs leading-tight text-amber-200"><Footprints className="ml-auto h-3.5 w-3.5" />{o.walkMinutes} min<br /><span className="text-neutral-500">{o.walkMeters} m</span></span>
                  </button>
                ))}
                <p className="pt-1 text-[11px] text-neutral-500">{occ ? "Ranked by walking distance; full lots last. Free spaces are SIMULATED (preview)." : "Ranked by walking distance (estimated). Free spaces appear here once the lots' cameras are connected."}</p>
              </div>
            )}
          </section>
        )}
        {osm && (
          <>
            <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Complex</p>
              <p className="mt-1 text-lg font-semibold text-white">{osm.name}</p>
              {osm.detail && <p className="text-xs text-neutral-400">{osm.detail}</p>}
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat icon={Building2} value={counts.complex} label={counts.hasOutline ? `buildings (${counts.named} named)` : "buildings in view"} />
                <Stat icon={Car} value={counts.hasOutline ? summary.onSite : summary.lots} label={counts.hasOutline ? `lots on site · ${summary.lots - summary.onSite} nearby` : `lots${summary.garages ? ` (${summary.garages} garages)` : ""}`} />
                {occTotals
                  ? <Stat icon={Activity} value={occTotals.free.toLocaleString()} label={`free of ${occTotals.total.toLocaleString()} (simulated)`} />
                  : <Stat value={summary.capacity ? summary.capacity.toLocaleString() : "—"} label={summary.capacity ? `spaces in ${summary.withCapacity} lots` : "capacity unknown"} />}
              </div>
              <p className="mt-3 text-xs text-neutral-500">
                {counts.hasOutline
                  ? `Buildings inside the site's outline (orange line). ${counts.around.toLocaleString()} more around it are shown lighter. `
                  : "OpenStreetMap has no outline for this place, so every building in view is counted. "}
                {simOn ? "Free spaces below are made up, to preview how the lot cameras will look." : "Parking occupancy comes from the lot cameras (not connected yet)."}
              </p>
              <button onClick={() => setSimOn((v) => !v)} role="switch" aria-checked={simOn}
                className={`mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ring-1 transition ${simOn ? "bg-amber-400/10 text-amber-100 ring-amber-400/50" : "bg-white/[0.03] text-neutral-200 ring-white/10 hover:bg-white/[0.06]"}`}>
                <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${simOn ? "bg-amber-400" : "bg-neutral-600"}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${simOn ? "left-[18px]" : "left-0.5"}`} />
                </span>
                <span><span className="block font-semibold">Preview with cameras</span><span className="block text-[11px] text-neutral-400">Simulated free spaces, so you can see how it will work</span></span>
              </button>
            </section>
            <section style={{ maxHeight: "max(240px, calc(100vh - 470px))" }} className="min-h-0 overflow-auto rounded-xl border border-neutral-800 bg-neutral-900/60 p-2">
              <p className="px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-neutral-500">Parking ({lots.length})</p>
              {lots.map((l) => (
                <button key={l.id} onClick={() => { engine.current?.flyToLot(l); setPicked(l); }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/5 ${picked?.id === l.id ? "bg-sky-500/15 text-sky-100" : "text-neutral-200"}`}>
                  <span className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-black text-white" style={{ background: occ?.get(l.id) ? LEVEL_COLOR[occupancyLevel(occ.get(l.id))] : "#0ea5e9" }}>P</span>
                  <span className="truncate">{l.name || (/multi/.test(l.kind) ? "Parking structure" : "Unnamed lot")}</span>
                  <span className="ml-auto shrink-0 text-xs text-neutral-500">
                    {occ?.get(l.id)
                      ? <><FreeBadge o={occ.get(l.id)} /><span className="text-neutral-500"> / {occ.get(l.id).total}</span></>
                      : [l.inComplex === false && counts.hasOutline ? "nearby" : "", l.capacity ? `${l.capacity} sp.` : /multi/.test(l.kind) ? "garage" : ""].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </section>
          </>
        )}
      </aside>

      <section style={{ height: "max(420px, calc(100vh - 90px))" }} className="relative order-first min-h-0 w-full flex-1 overflow-hidden rounded-xl lg:order-none border border-neutral-800 bg-[#0b1117]">
        <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="3D map of the complex" />
        {!osm && !busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-neutral-300">
            <Building2 className="h-10 w-10 text-sky-300" />
            <p className="max-w-md text-sm">Find a university, hospital or stadium by name: its buildings, roads and parking lots are built in 3D from OpenStreetMap.</p>
            <button
              onClick={async () => {
                setBusy("Loading the Wayne State demo…");
                try { const r = await fetch(`${import.meta.env.BASE_URL || "/"}demo/wayne-state-osm.json`); await openFile(await r.blob(), "Wayne State University"); typed.current = false; setQuery("Wayne State University"); } catch { setError("Could not load the demo"); }
                setBusy("");
              }}
              className="rounded-md border border-sky-400/50 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/10">Load the Wayne State demo</button>
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-xs text-neutral-400 underline"><FileUp className="h-3.5 w-3.5" /> or open an OpenStreetMap (Overpass JSON) file</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
        {occ && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-[70%] rounded-xl bg-black/65 px-3 py-2 text-xs text-white ring-1 ring-amber-400/40 backdrop-blur">
            <p className="flex items-center gap-2 font-semibold text-amber-200">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" /></span>
              SIMULATED preview · not real camera data
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-neutral-300">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR.plenty }} />Plenty</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR.filling }} />Filling up</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR.almost }} />Almost full / full</span>
              <span className="text-neutral-500">updated {new Date(occAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </p>
          </div>
        )}
        {osm && (
          <div className="absolute right-3 top-3 flex gap-1.5">
            <button onClick={() => engine.current?.fit()} className="rounded-lg bg-black/55 p-2 text-neutral-200 ring-1 ring-white/10 backdrop-blur" title="Whole complex"><Crosshair className="h-4 w-4" /></button>
            <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="rounded-lg bg-black/55 p-2 text-neutral-200 ring-1 ring-white/10 backdrop-blur" title="Light / dark">{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          </div>
        )}
        {picked?.building && (
          <div className="absolute bottom-10 left-3 max-w-[80%] rounded-xl bg-black/70 px-4 py-3 text-sm text-white ring-1 ring-white/10 backdrop-blur">
            <p className="font-semibold">{picked.building.name || picked.building.address || "Unnamed building"}</p>
            <p className="text-xs text-neutral-300">
              {[picked.building.name && picked.building.address, picked.building.inComplex === false ? `Outside ${osm?.name || "the complex"}` : "", !picked.building.name ? "No name on OpenStreetMap" : ""].filter(Boolean).join(" · ")}
            </p>
            <button onClick={() => goTo({ ...picked.building, name: picked.building.name || picked.building.address || "Selected building" })}
              className="mt-2 flex items-center gap-1.5 rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-500"><Car className="h-3.5 w-3.5" /> Park closest to here</button>
          </div>
        )}
        {picked && !picked.building && (
          <div className="absolute bottom-10 left-3 rounded-xl bg-black/70 px-4 py-3 text-sm text-white ring-1 ring-white/10 backdrop-blur">
            <p className="font-semibold">{picked.name || "Parking"}</p>
            <p className="text-xs text-neutral-300">{/multi/.test(picked.kind) ? "Parking structure" : "Surface lot"}{picked.point ? " · location only (size approximate)" : ""}{picked.capacity ? ` · ${picked.capacity} spaces` : ""}{picked.fee === "yes" ? " · paid" : ""}{picked.access && picked.access !== "yes" ? ` · ${picked.access}` : ""}</p>
            {occ?.get(picked.id) ? (() => {
              const o = occ.get(picked.id);
              const used = 1 - o.free / o.total;
              return (
                <div className="mt-2 w-56">
                  <p className="flex items-baseline justify-between text-sm"><FreeBadge o={o} className="text-base" /><span className="text-xs text-neutral-400">of {o.total}{o.estimated ? " (size estimate)" : ""}</span></p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.round(used * 100)}%`, background: LEVEL_COLOR[occupancyLevel(o)] }} /></div>
                  <p className="mt-1 text-[11px] text-amber-200/80">Simulated: {o.trend > 0 ? "filling up" : o.trend < 0 ? "emptying" : "steady"}</p>
                </div>
              );
            })() : <p className="mt-1 text-xs text-neutral-400">Free spaces: connect this lot&apos;s camera</p>}
          </div>
        )}
        <p className="absolute bottom-2 right-3 text-[11px] text-neutral-400">
          Map data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">{ATTRIBUTION}</a>
          <span className="ml-2 text-neutral-600" title="App version">v {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}</span>
        </p>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-1 py-2">
      <p className="flex items-center justify-center gap-1 text-lg font-bold tabular-nums text-white">{Icon && <Icon className="h-4 w-4 text-sky-300" />}{value}</p>
      <p className="text-[10px] leading-tight text-neutral-500">{label}</p>
    </div>
  );
}
