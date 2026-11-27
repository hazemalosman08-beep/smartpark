import React, { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Car, Crosshair, FileUp, Loader2, Moon, Search, Sun } from "lucide-react";
import { ATTRIBUTION, fetchArea, findPlaces, parseOsm, parkingSummary } from "@/lib/osm";
import { CampusScene } from "@/lib/three/campusScene";
import { loadPhoto, savePhoto } from "@/lib/photoStore";

// A whole complex in 3D from OpenStreetMap: find it by name, see every
// building, road and parking lot. (Occupancy from cameras comes on top later.)
export default function CampusView() {
  const canvasRef = useRef(null);
  const engine = useRef(null);
  const fileRef = useRef(null);
  const [query, setQuery] = useState("Wayne State University");
  const [places, setPlaces] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [osm, setOsm] = useState(null);
  const [picked, setPicked] = useState(null);
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const e = new CampusScene(canvasRef.current, { onPick: setPicked });
    engine.current = e;
    const parent = canvasRef.current.parentElement;
    const ro = new ResizeObserver(() => e.resize(parent.clientWidth, parent.clientHeight));
    ro.observe(parent);
    e.resize(parent.clientWidth, parent.clientHeight);
    e.start();
    // The last complex comes back after a reload.
    loadPhoto("osm").then(async (blob) => { if (blob) { try { setOsm(JSON.parse(await blob.text())); } catch { /* ignore */ } } });
    return () => { ro.disconnect(); e.dispose(); };
  }, []);
  useEffect(() => { if (osm) engine.current?.setData(osm); }, [osm]);
  useEffect(() => { engine.current?.setTheme(theme); }, [theme]);

  const keep = (data) => { setOsm(data); setPicked(null); savePhoto(new Blob([JSON.stringify(data)], { type: "application/json" }), "osm"); };

  const search = async (e) => {
    e?.preventDefault();
    setError(""); setPlaces(null); setBusy("Searching OpenStreetMap…");
    try {
      const found = await findPlaces(query);
      setPlaces(found);
      if (!found.length) setError("Nothing found with that name. Try the full name, e.g. \"Wayne State University\".");
      else if (found.length === 1) await load(found[0]);
    } catch (err) { setError(err.message || "Could not reach OpenStreetMap"); }
    setBusy("");
  };
  const load = async (place) => {
    setError(""); setBusy(`Downloading ${place.name}…`);
    try {
      const data = await fetchArea(place.bounds);
      keep({ ...data, name: place.name });
      setPlaces(null);
    } catch (err) { setError(err.message || "Could not download the map"); }
    setBusy("");
  };
  // An Overpass JSON file (e.g. exported from overpass-turbo.eu).
  const openFile = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const pts = (data.elements || []).flatMap((el) => el.geometry || (el.lat ? [el] : []) || []).filter((g) => g && Number.isFinite(g.lat));
      if (!pts.length) throw new Error("No map data in this file");
      const bounds = { minlat: Math.min(...pts.map((g) => g.lat)), maxlat: Math.max(...pts.map((g) => g.lat)), minlon: Math.min(...pts.map((g) => g.lon)), maxlon: Math.max(...pts.map((g) => g.lon)) };
      keep({ ...parseOsm(data, bounds), bounds, name: file.name.replace(/\.json$/i, ""), fetchedAt: new Date().toISOString() });
    } catch (err) { setError(err.message || "Could not read the file"); }
  };

  const summary = useMemo(() => (osm ? parkingSummary(osm) : null), [osm]);
  const lots = useMemo(() => (osm ? osm.parking.filter((p) => !p.space).sort((a, b) => (a.name || "~").localeCompare(b.name || "~", undefined, { numeric: true })) : []), [osm]);

  return (
    <div className="flex flex-1 flex-col gap-3 p-3 lg:flex-row lg:p-4">
      <aside className="flex flex-col gap-3 lg:w-[330px] lg:shrink-0">
        <form onSubmit={search} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="University, hospital, stadium…" className="w-full rounded-md border border-neutral-700 bg-neutral-900 py-2 pl-8 pr-2 text-sm text-white" />
          </div>
          <button disabled={Boolean(busy)} className="rounded-md bg-sky-500 px-3 text-sm font-semibold text-white disabled:opacity-50">Find</button>
        </form>
        {busy && <p className="flex items-center gap-2 text-sm text-sky-200"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</p>}
        {error && <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        {places?.length > 1 && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-2 text-sm">
            <p className="mb-1 px-1 text-[11px] uppercase tracking-wider text-neutral-500">Which one?</p>
            {places.slice(0, 8).map((p) => (
              <button key={p.id} onClick={() => load(p)} className="block w-full rounded px-2 py-1.5 text-left text-neutral-200 hover:bg-white/5">{p.name} <span className="text-neutral-500">· {p.kind}</span></button>
            ))}
          </div>
        )}
        {osm && (
          <>
            <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Complex</p>
              <p className="mt-1 text-lg font-semibold text-white">{osm.name}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat icon={Building2} value={osm.buildings.filter((b) => !b.part).length} label="buildings" />
                <Stat icon={Car} value={summary.lots} label={`lots${summary.garages ? ` (${summary.garages} garages)` : ""}`} />
                <Stat value={summary.capacity ? summary.capacity.toLocaleString() : "—"} label={summary.capacity ? `spaces in ${summary.withCapacity} lots` : "capacity unknown"} />
              </div>
              <p className="mt-3 text-xs text-neutral-500">Parking occupancy comes from the lot cameras (not connected yet).</p>
            </section>
            <section className="min-h-0 flex-1 overflow-auto rounded-xl border border-neutral-800 bg-neutral-900/60 p-2">
              <p className="px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-neutral-500">Parking ({lots.length})</p>
              {lots.map((l) => (
                <button key={l.id} onClick={() => { engine.current?.flyToLot(l); setPicked(l); }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/5 ${picked?.id === l.id ? "bg-sky-500/15 text-sky-100" : "text-neutral-200"}`}>
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-sky-500 text-[11px] font-black text-white">P</span>
                  <span className="truncate">{l.name || (/multi/.test(l.kind) ? "Parking structure" : "Unnamed lot")}</span>
                  <span className="ml-auto shrink-0 text-xs text-neutral-500">{l.capacity ? `${l.capacity} sp.` : /multi/.test(l.kind) ? "garage" : ""}</span>
                </button>
              ))}
            </section>
          </>
        )}
      </aside>

      <section className="relative min-h-[60vh] flex-1 overflow-hidden rounded-xl border border-neutral-800 bg-[#0b1117]">
        <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="3D map of the complex" />
        {!osm && !busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-neutral-300">
            <Building2 className="h-10 w-10 text-sky-300" />
            <p className="max-w-md text-sm">Find a university, hospital or stadium by name: its buildings, roads and parking lots are built in 3D from OpenStreetMap.</p>
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-xs text-neutral-400 underline"><FileUp className="h-3.5 w-3.5" /> or open an OpenStreetMap (Overpass JSON) file</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
        {osm && (
          <div className="absolute right-3 top-3 flex gap-1.5">
            <button onClick={() => engine.current?.fit()} className="rounded-lg bg-black/55 p-2 text-neutral-200 ring-1 ring-white/10 backdrop-blur" title="Whole complex"><Crosshair className="h-4 w-4" /></button>
            <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="rounded-lg bg-black/55 p-2 text-neutral-200 ring-1 ring-white/10 backdrop-blur" title="Light / dark">{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          </div>
        )}
        {picked && (
          <div className="absolute bottom-10 left-3 rounded-xl bg-black/70 px-4 py-3 text-sm text-white ring-1 ring-white/10 backdrop-blur">
            <p className="font-semibold">{picked.name || "Parking"}</p>
            <p className="text-xs text-neutral-300">{/multi/.test(picked.kind) ? "Parking structure" : "Surface lot"}{picked.capacity ? ` · ${picked.capacity} spaces` : ""}{picked.fee === "yes" ? " · paid" : ""}{picked.access && picked.access !== "yes" ? ` · ${picked.access}` : ""}</p>
            <p className="mt-1 text-xs text-neutral-400">Free spaces: connect this lot&apos;s camera</p>
          </div>
        )}
        <p className="absolute bottom-2 right-3 text-[11px] text-neutral-400">
          Map data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">{ATTRIBUTION}</a>
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
