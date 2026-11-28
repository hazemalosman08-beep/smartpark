import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Building2, Car, Crosshair, FileUp, Footprints, Loader2, Lock, MapPin, Moon, Plus, Search, ShieldCheck, Sun, Video, X } from "lucide-react";
import { feedOccupancy, placeKey } from "@/lib/campusFeeds";
import LiveLotView from "@/components/SmartPark/LiveLotView";
import { ATTRIBUTION, buildingCounts, destinations, fetchArea, fetchOutline, fetchRaw, mainOutlineBounds, mergeOsm, tilesToLoad, toLatLon, limitBounds, nearestParking, parkingSummary, parseOsm, searchDestinations, searchPlaces } from "@/lib/osm";
import { CampusScene } from "@/lib/three/campusScene";
import { LEVEL_COLOR, createSimulation, occupancyLevel } from "@/lib/occupancySim";
import { STATES, stateByCode } from "@/lib/usStates";
import { COUNTRIES, countryArea, countryByCode, matchOption } from "@/lib/countries";

const pref = (key, fallback = "") => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const savePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* blocked */ } };

// A box you can type in (with suggestions) or pick from: a country, a state.
function TypePick({ label, options, value, onChange, placeholder, id }) {
  const [text, setText] = useState(value?.name || "");
  useEffect(() => { setText(value?.name || ""); }, [value?.code]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (t) => {
    if (!t.trim()) { onChange(null); setText(""); return; }
    const m = matchOption(options, t);
    if (m) { onChange(m); setText(m.name); } else setText(value?.name || "");
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
      {label}
      <span className="relative">
        <input
          list={id} value={text} placeholder={placeholder} aria-label={label}
          onChange={(e) => {
            setText(e.target.value);
            const m = options.find((o) => o.name.toLowerCase() === e.target.value.trim().toLowerCase());
            if (m) onChange(m);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value); e.currentTarget.blur(); } }}
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 py-1.5 pl-2 pr-6 text-xs normal-case tracking-normal text-white placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none"
        />
        {value && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(null); setText(""); }} aria-label={`Clear ${label}`} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"><X className="h-3 w-3" /></button>}
      </span>
      <datalist id={id}>{options.map((o) => <option key={o.code} value={o.name} />)}</datalist>
    </label>
  );
}

// A big place can be explored up to this size (around its own point);
// more of it is loaded as the view moves.
const MAX_EXPLORE_M = 12000;
const AROUND_M = 8000;

function around(b, m) {
  const lat = (b.minlat + b.maxlat) / 2, lon = (b.minlon + b.maxlon) / 2;
  const dLat = m / 2 / 111320, dLon = m / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return { minlat: lat - dLat, maxlat: lat + dLat, minlon: lon - dLon, maxlon: lon + dLon };
}

function clampBox(b, maxM, centre) {
  const lat = (b.minlat + b.maxlat) / 2;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
  const hw = Math.min((b.maxlon - b.minlon) * kx, maxM) / 2 / kx, hh = Math.min((b.maxlat - b.minlat) * ky, maxM) / 2 / ky;
  const c = centre && Number.isFinite(centre.lat) ? centre : { lat, lon: (b.minlon + b.maxlon) / 2 };
  const cl = Math.min(b.maxlat - hh, Math.max(b.minlat + hh, c.lat)), co = Math.min(b.maxlon - hw, Math.max(b.minlon + hw, c.lon));
  return { minlat: cl - hh, maxlat: cl + hh, minlon: co - hw, maxlon: co + hw };
}


// Farther than this (about 10 minutes on foot) is not a real recommendation.
const FAR_WALK_M = 800;

function StepDot({ n, active = false, done = false }) {
  return <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-sky-500/30 text-sky-100" : active ? "bg-amber-400 text-neutral-900" : "bg-neutral-700 text-neutral-300"}`}>{n}</span>;
}

// The lot chosen for the driver: the first option, unless even that is too
// far to recommend (then nothing is chosen; the driver can still pick one).
const firstChoice = (options) => (options[0] && options[0].allowed !== false && options[0].walkMeters <= FAR_WALK_M ? options[0] : null);

// Closest parking; with occupancy data, full lots go to the end.
function rankParking(osm, building, permit, occ) {
  const all = nearestParking(osm, building, 8, { permit });
  const full = (o) => occ?.get(o.lot.id)?.free === 0;
  // Usable lots with space, then usable but full, then lots the driver may not use.
  const rank = (o) => (!o.allowed ? 2 : full(o) ? 1 : 0);
  return all.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o).slice(0, 5);
}

// The card of a picked lot, pinned to the lot on the map (it follows the
// view). Staff can add, open or remove the lot's live feed.
function LotCard({ lot, engine, o, feed, staff, active, onAdd, onOpen, onRemove, onClose, onInside }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const loop = () => {
      const p = engine.current?.screenOf(lot);
      const el = ref.current;
      if (el) {
        if (p) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; el.style.visibility = "visible"; } else el.style.visibility = "hidden";
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [lot, engine]);
  const used = o && o.total ? 1 - o.free / o.total : 0;
  return (
    <div ref={ref} className="absolute z-10 w-60 -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-xl bg-[#14361f]/95 p-3 text-center text-sm text-white shadow-2xl ring-2 ring-green-400/70 backdrop-blur" style={{ visibility: "hidden" }}>
      <button onClick={onClose} aria-label="Close" className="absolute right-2 top-2 text-green-100/60 hover:text-white"><X className="h-3.5 w-3.5" /></button>
      <p className="px-4 text-base font-bold leading-tight">{lot.name || (/multi/.test(lot.kind) ? "Parking structure" : "Parking lot")}</p>
      <p className="mt-0.5 text-[11px] text-green-100/70">{/multi/.test(lot.kind) ? "Parking structure" : "Surface lot"}{lot.point ? " · location only" : ""}{lot.capacity ? ` · ${lot.capacity} spaces` : ""}{lot.fee === "yes" ? " · paid" : ""}{lot.access && lot.access !== "yes" ? ` · ${lot.access}` : ""}</p>
      {o && (
        <div className="mt-2 text-left">
          <p className="flex items-baseline justify-between"><FreeBadge o={o} className="text-sm" /><span className="text-[11px] text-green-100/60">of {o.total}{o.estimated ? " (size estimate)" : ""}</span></p>
          {!o.stale && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.round(used * 100)}%`, background: LEVEL_COLOR[occupancyLevel(o)] }} /></div>}
          <p className="mt-1 text-[10px] text-green-100/60">{o.live ? `Camera reading ${ago(o.at)}` : `Simulated: ${o.trend > 0 ? "filling up" : o.trend < 0 ? "emptying" : "steady"}`}</p>
        </div>
      )}
      {!o && !staff && <p className="mt-1 text-[11px] text-green-100/60">No camera on this lot yet</p>}
      {feed?.reading?.spaces?.length > 0 && (
        <button onClick={() => onInside(feed)} className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-500 px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-green-400">
          <Car className="h-4 w-4" /> See inside (live)
        </button>
      )}
      {staff && !feed && lot.id && (
        <button onClick={onAdd} className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0b1f12] px-3 py-2 text-sm font-medium text-white ring-1 ring-white/10 hover:bg-black">
          <Plus className="h-4 w-4" /> Add live feed
        </button>
      )}
      {staff && feed && (
        <div className="mt-2.5 flex gap-1.5">
          <button onClick={() => onOpen(feed)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0b1f12] px-2 py-1.5 text-xs text-white ring-1 ring-white/10 hover:bg-black">
            <Video className="h-3.5 w-3.5" /> {active ? "Camera running" : "Open camera"}
          </button>
          <button onClick={() => onRemove(feed)} className="rounded-lg px-2 py-1.5 text-xs text-red-200 ring-1 ring-red-400/40 hover:bg-red-500/10">Remove</button>
        </div>
      )}
    </div>
  );
}

function FreeBadge({ o, className = "" }) {
  if (!o) return null;
  const level = occupancyLevel(o);
  if (o.stale) return <span className={`font-semibold ${className}`} style={{ color: LEVEL_COLOR.unknown }}>No recent data</span>;
  return <span className={`font-semibold tabular-nums ${className}`} style={{ color: LEVEL_COLOR[level] }}>{o.live && <span className="mr-1 text-[0.8em] text-green-300">● LIVE</span>}{o.free ? `${o.free} free` : "Full"}</span>;
}

const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

// A whole complex in 3D from OpenStreetMap: find it by name, see every
// building, road and parking lot. (Occupancy from cameras comes on top later.)
// The complex stays while switching tabs, but not after the app is reloaded
// or reopened (it then starts clean).
let visitOsm = null;

export default function CampusView({ mode = "user", feeds = [], activeFeedId = null, onAddFeed, onOpenFeed, onRemoveFeed }) {
  const staff = mode === "staff";
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
  // Where to search: a country first, then (United States) a state. Kept
  // on this device. (An earlier version kept only a state: that means US.)
  const [countryCode, setCountryCode] = useState(() => pref("smartpark.country", pref("smartpark.state") ? "US" : ""));
  const [stateCode, setStateCode] = useState(() => pref("smartpark.state"));
  const [area, setArea] = useState(null); // the country's search area
  const country = countryByCode(countryCode);
  const searchState = countryCode === "US" ? stateByCode(stateCode) : null;
  const searchCountry = country ? { ...country, area: area?.code === countryCode ? area.area : null } : null;
  const where = searchState ? searchState.name : country?.name || "";
  const whereKey = `${countryCode}/${searchState?.code || ""}/${area?.code === countryCode ? 1 : 0}`;
  const [picked, setPicked] = useState(null);
  const [theme, setTheme] = useState("dark");
  const touch = useMemo(() => { try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; } }, []);
  // "Where are you going?"
  const [goText, setGoText] = useState("");
  const [goOpen, setGoOpen] = useState(false);
  const [trip, setTrip] = useState(null); // { building, options, chosen }
  const [permit, setPermit] = useState(() => { try { return localStorage.getItem("smartpark.permit") === "1"; } catch { return false; } });
  // Preview of live camera data with made-up numbers (clearly labelled).
  const [simOn, setSimOn] = useState(false);
  const [simOcc, setOcc] = useState(null); // simulated: Map lot id -> { free, total, estimated, trend }
  const [occAt, setOccAt] = useState(0);
  const occRef = useRef(null);

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
  // More of a big place, loaded as the view moves: merged in place (the
  // view, the trip and the search stay as they are).
  const extending = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const osmRef = useRef(null);
  osmRef.current = osm;
  useEffect(() => {
    if (!osm) return;
    if (extending.current) { extending.current = false; engine.current?.setData(osm, { fit: false }); return; }
    engine.current?.setData(osm); setTrip(null); setGoText("");
  }, [osm]);
  useEffect(() => {
    // Tiles in view first (nearest to the centre), two downloads at a time;
    // each is merged as soon as it arrives and the map redrawn at most once
    // a second. Then a ring around the view is fetched quietly, so the next
    // move is usually already there.
    const st = { place: null, queue: [], inFlight: new Set(), done: new Set(), visible: new Set(), map: null, flushed: 0, timer: null };
    const indicator = () => setLoadingMore([...st.inFlight, ...st.queue.map((q) => q.id)].some((id) => st.visible.has(id)));
    const flush = () => {
      st.timer = null;
      st.flushed = Date.now();
      if (!st.map || st.map === osmRef.current) return;
      extending.current = true;
      visitOsm = st.map;
      setOsm(st.map);
    };
    const scheduleFlush = () => { if (!st.timer) st.timer = setTimeout(flush, Math.max(0, 1000 - (Date.now() - st.flushed))); };
    const pump = () => {
      while (st.inFlight.size < 2 && st.queue.length) {
        const t = st.queue.shift();
        if (st.done.has(t.id) || st.inFlight.has(t.id)) continue;
        st.inFlight.add(t.id);
        const place = st.place;
        fetchRaw(t.box)
          .then((data) => {
            if (st.place !== place) return;
            const base = st.map || osmRef.current;
            st.map = mergeOsm(base, parseOsm(data, base.bounds), t.box);
            st.done.add(t.id);
            scheduleFlush();
          })
          .catch(() => { /* tried again on the next move */ })
          .finally(() => { st.inFlight.delete(t.id); indicator(); pump(); });
      }
      indicator();
    };
    const onView = (v) => {
      const o = osmRef.current;
      if (!o?.full) return;
      if (st.place !== o.fetchedAt) Object.assign(st, { place: o.fetchedAt, queue: [], done: new Set(), map: null });
      const base = st.map || o;
      const at = toLatLon(o.bounds, v.x, v.y);
      const r = Math.min(1400, Math.max(450, v.distance * 0.9));
      const visible = tilesToLoad(at, r, o.full, base.loaded, st.done);
      const ring = tilesToLoad(at, r + 900, o.full, base.loaded, st.done).filter((t) => !visible.some((x) => x.id === t.id)).slice(0, 8);
      st.visible = new Set(visible.map((t) => t.id));
      st.queue = [...visible, ...ring];
      pump();
    };
    if (engine.current) engine.current.onViewChange = onView;
  }, []);
  useEffect(() => { engine.current?.setTrip(trip, { fly: trip?.fly !== false }); }, [trip]);
  useEffect(() => { if (engine.current) engine.current.onPickTrip = (o) => setTrip((t) => (t ? { ...t, chosen: o, fly: false } : t)); }, []);
  // Changing the permit switch re-ranks the current trip.
  useEffect(() => {
    try { localStorage.setItem("smartpark.permit", permit ? "1" : "0"); } catch { /* blocked */ }
    setTrip((t) => { if (!t || !osm) return t; const options = rankParking(osm, t.building, permit, occRef.current); return { ...t, options, chosen: firstChoice(options) }; });
  }, [permit, osm, simOn]);
  // The simulation: new numbers every few seconds while the preview is on.
  const simRef = useRef(null);
  useEffect(() => {
    if (!simOn || !osmRef.current) { setOcc(null); simRef.current = null; return undefined; }
    let seed = 7;
    for (const ch of osmRef.current.name || "") seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const sim = createSimulation(osmRef.current, { seed });
    simRef.current = sim;
    const tick = () => { setOcc(sim.snapshot()); setOccAt(Date.now()); };
    tick();
    const id = setInterval(() => { sim.ensure(osmRef.current); sim.step(); tick(); }, 4000);
    return () => clearInterval(id);
  }, [simOn, osm?.name, osm?.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Lots loaded later get numbers at once.
  useEffect(() => { if (simRef.current && osm) { simRef.current.ensure(osm); setOcc(simRef.current.snapshot()); } }, [osm]);
  // Live feeds of this place (real counts from the lots' cameras) on top of
  // the simulated preview (if it is on). Re-checked every 30 s for age.
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(id); }, []);
  const key = osm ? placeKey(osm) : "";
  const placeFeeds = useMemo(() => feeds.filter((f) => f.place === key), [feeds, key]);
  const feedOcc = useMemo(() => feedOccupancy(placeFeeds, key, clock), [placeFeeds, key, clock]);
  const occ = useMemo(() => {
    if (!simOcc && !feedOcc.size) return null;
    const m = new Map(simOcc || []);
    for (const [k, v] of feedOcc) m.set(k, v);
    return m;
  }, [simOcc, feedOcc]);
  occRef.current = occ;
  const feedByLot = useMemo(() => new Map(placeFeeds.map((f) => [f.lotId, f])), [placeFeeds]);
  // Inside a live lot: its own 3D guide (by feed id, so it follows new readings).
  const [insideId, setInsideId] = useState(null);
  const insideFeed = placeFeeds.find((f) => f.id === insideId) || null;
  useEffect(() => { engine.current?.setOccupancy(occ, { staff, feeds: feedByLot }); }, [occ, staff, feedByLot]);
  const occTotals = useMemo(() => {
    if (!occ) return null;
    let free = 0, total = 0, estimated = 0;
    let live = 0;
    for (const o of occ.values()) { if (o.stale) continue; free += o.free; total += o.total; if (o.estimated) estimated += 1; if (o.live) live += 1; }
    return { free, total, estimated, lots: occ.size, live };
  }, [occ]);
  const buildingsList = useMemo(() => (osm ? destinations(osm) : []), [osm]);
  const suggestions = useMemo(() => searchDestinations(buildingsList, goText), [buildingsList, goText]);
  const goTo = (building) => {
    const options = rankParking(osm, building, permit, occRef.current);
    setTrip({ building, options, chosen: firstChoice(options) });
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
        const found = await searchPlaces(q, { signal: ctl.signal, near, state: searchState, country: searchCountry });
        setPlaces(found); placesFor.current = `${q}|${whereKey}`; setActive(0); setPlacesOpen(true); setError("");
      } catch (err) {
        if (err?.name !== "AbortError") setError(navigator.onLine === false ? "You are offline." : "Place search is not reachable right now. Try again in a moment.");
      }
      setPlacesBusy(false);
    }, 280);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query, whereKey]);
  useEffect(() => { savePref("smartpark.country", countryCode); savePref("smartpark.state", countryCode === "US" ? stateCode : ""); }, [countryCode, stateCode]);
  // The country's area for the search (looked up once per country).
  useEffect(() => {
    if (!country) return undefined;
    const ctl = new AbortController();
    countryArea(country, { signal: ctl.signal }).then((a) => { if (a) setArea({ code: country.code, area: a }); }).catch(() => {});
    return () => ctl.abort();
  }, [countryCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (place) => {
    setPlacesOpen(false); setError("");
    typed.current = false;
    setQuery(place.name);
    // Too big to show whole (e.g. a university whose outline takes in its
    // airport and farms): its main piece, centred on the place itself.
    let area = place.bounds;
    if (limitBounds(area).limited && place.osm) {
      setBusy(`Finding ${place.name}…`);
      const outline = await fetchOutline(place.osm).catch(() => null);
      area = (outline && mainOutlineBounds(outline, area)) || area;
    }
    const { bounds, limited } = limitBounds(area, place.centre);
    setBusy(`Downloading ${place.name}…`);
    try {
      const data = await fetchArea(bounds, { onStatus: setBusy, outlineOf: place.osm });
      if (!data.buildings.length && !data.parking.length && !data.roads.length) throw new Error("OpenStreetMap has no buildings or roads mapped here yet.");
      // The area that can be explored by dragging: the whole place if it is
      // big, else about 8 km around it (a bridge, a stadium and what is
      // around them); more of it loads as the view moves.
      keep({ ...data, name: place.name, detail: place.detail, limited, full: limited ? clampBox(place.bounds, MAX_EXPLORE_M, place.centre) : around(bounds, AROUND_M) });
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
    if (placesFor.current !== `${q}|${whereKey}` && q.length >= 2) {
      setPlacesBusy(true);
      try {
        const found = await searchPlaces(q, { state: searchState, country: searchCountry });
        placesFor.current = `${q}|${whereKey}`;
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
        <div className="flex gap-2 px-0.5">
          <TypePick id="sp-countries" label="Country" placeholder="Any country" options={COUNTRIES} value={country}
            onChange={(c) => { setCountryCode(c?.code || ""); if (c?.code !== "US") setStateCode(""); typed.current = true; }} />
          {countryCode === "US" && (
            <TypePick id="sp-states" label="State" placeholder="Any state" options={STATES} value={searchState}
              onChange={(st) => { setStateCode(st?.code || ""); typed.current = true; }} />
          )}
        </div>
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
            placeholder={where ? `Search in ${where}…` : "Search a university, hospital, stadium, address…"}
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
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-400">No places found{where ? ` in ${where}` : ""}</div>
          )}
        </form>
        {busy && <p className="flex items-center gap-2 text-sm text-sky-200"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</p>}
        {error && <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        {osm?.limited && <p className="text-[11px] text-amber-200/80">This place is large: it opens on its main site. Drag the map to explore the rest; it loads as you go.</p>}
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
              <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100 ring-1 ring-amber-400/30">
                <p className="text-sm font-semibold">Look for street parking nearby</p>
                <p className="mt-1">No parking lot near {trip.building.name} is in the map data, so street spots close to the building are your best option.</p>
                {trip.options[0] && (
                  <p className="mt-1 text-amber-200/70">
                    The closest lot we know of is {trip.options[0].walkMeters >= 1000 ? `${(trip.options[0].walkMeters / 1000).toFixed(1)} km` : `${trip.options[0].walkMeters} m`} away (about {trip.options[0].walkMinutes} min on foot); lots are listed below if you prefer one.
                  </p>
                )}
              </div>
            )}
            {trip?.chosen && feedByLot.get(trip.chosen.lot.id)?.reading?.spaces?.length > 0 && (
              <button onClick={() => setInsideId(feedByLot.get(trip.chosen.lot.id).id)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-3 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-green-400">
                <Car className="h-4 w-4" /> Guide me to a free space in {trip.chosen.lot.name || "this lot"}
              </button>
            )}
            {trip && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-500">{trip.chosen || trip.options.some((o) => o.allowed !== false && o.walkMeters <= FAR_WALK_M) ? "Closest parking" : "Lots in the data (far)"}</p>
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
                <p className="pt-1 text-[11px] text-neutral-500">{occ ? `Ranked by walking distance; full lots last.${simOcc ? " Free spaces are SIMULATED (preview) except lots marked LIVE." : ""}` : "Ranked by walking distance (estimated). Free spaces appear here once the lots' cameras are connected."}</p>
              </div>
            )}
          </section>
        )}
        {osm && staff && (
          <section className="rounded-xl border border-green-500/30 bg-green-500/[0.05] p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-green-100"><ShieldCheck className="h-4 w-4 text-green-300" /> Staff: live feeds</p>
            <p className="mt-1 text-xs text-green-100/70">Tap a parking lot on the map, then <b>+ Add live feed</b> to connect its camera. Drivers then see its free spaces.</p>
            {placeFeeds.length > 0 && (
              <ul className="mt-2 space-y-1">
                {placeFeeds.map((f) => {
                  const o = feedOcc.get(f.lotId);
                  const lot = osm.parking.find((p) => p.id === f.lotId);
                  return (
                    <li key={f.id}>
                      <button onClick={() => { if (lot) { engine.current?.flyToLot(lot); setPicked(lot); } }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-neutral-200 ring-1 ring-white/10 hover:bg-white/5">
                        <Video className={`h-3.5 w-3.5 shrink-0 ${f.id === activeFeedId ? "text-green-400" : "text-neutral-500"}`} />
                        <span className="min-w-0 flex-1 truncate">{f.lotName || "Unnamed lot"}</span>
                        {o ? <FreeBadge o={o} /> : <span className="text-neutral-500">no reading yet</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
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
                  ? <Stat icon={Activity} value={occTotals.free.toLocaleString()} label={`free of ${occTotals.total.toLocaleString()} (${simOcc ? (occTotals.live ? `${occTotals.live} live, rest simulated` : "simulated") : `live, ${occTotals.live} lot${occTotals.live === 1 ? "" : "s"}`})`} />
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
        {loadingMore && (
          <p className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/65 px-3 py-1 text-xs text-sky-100 ring-1 ring-white/10 backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more of the map…
          </p>
        )}
        {osm && (
          <p className="pointer-events-none absolute bottom-2 left-3 max-w-[60%] text-[11px] text-neutral-400">
            {touch ? "One finger: move · Two fingers: pinch to zoom, twist to turn, slide up or down to tilt" : "Drag: move · Scroll: zoom · Hold click + scroll, or right-drag: tilt and turn"}
          </p>
        )}
        {occ && (
          <div className={`pointer-events-none absolute left-3 top-3 max-w-[70%] rounded-xl bg-black/65 px-3 py-2 text-xs text-white ring-1 backdrop-blur ${simOcc ? "ring-amber-400/40" : "ring-green-400/40"}`}>
            <p className={`flex items-center gap-2 font-semibold ${simOcc ? "text-amber-200" : "text-green-200"}`}>
              <span className="relative flex h-2 w-2"><span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${simOcc ? "bg-amber-400" : "bg-green-400"}`} /><span className={`relative inline-flex h-2 w-2 rounded-full ${simOcc ? "bg-amber-400" : "bg-green-400"}`} /></span>
              {simOcc ? `SIMULATED preview · not real camera data${feedOcc.size ? ` (except ${feedOcc.size} LIVE lot${feedOcc.size === 1 ? "" : "s"})` : ""}` : `Live from ${feedOcc.size} camera${feedOcc.size === 1 ? "" : "s"}`}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-neutral-300">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR.plenty }} />Plenty</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR.filling }} />Filling up</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR.almost }} />Almost full / full</span>
              {simOcc && <span className="text-neutral-500">updated {new Date(occAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
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
          <LotCard lot={picked} engine={engine} o={occ?.get(picked.id)} feed={feedByLot.get(picked.id)} staff={staff} active={feedByLot.get(picked.id)?.id === activeFeedId}
            onInside={(f) => { setInsideId(f.id); setPicked(null); }}
            onAdd={() => onAddFeed?.(osm, picked)} onOpen={(f) => onOpenFeed?.(f)} onRemove={(f) => onRemoveFeed?.(f)} onClose={() => setPicked(null)} />
        )}
        {insideFeed && <LiveLotView feed={insideFeed} lotName={osm?.parking.find((p) => p.id === insideFeed.lotId)?.name || insideFeed.lotName} onBack={() => setInsideId(null)} />}
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
