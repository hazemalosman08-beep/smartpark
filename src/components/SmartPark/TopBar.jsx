import React from "react";
import { Link } from "react-router-dom";
import { Camera, Map, Navigation } from "lucide-react";
import InstallButton from "@/components/SmartPark/InstallButton";

const TABS = [
  { key: "camera", label: "Camera", icon: Camera, hint: "Detect & map" },
  { key: "lot", label: "Lot", icon: Map, hint: "Live plan" },
];

export default function TopBar({ tab, setTab, status }) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
      <h1 className="text-base font-bold tracking-[0.3em] text-green-400">SMARTPARK</h1>
      <nav className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.key ? "bg-green-500 text-neutral-950" : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
            <span className={`hidden text-[10px] sm:inline ${tab === t.key ? "text-neutral-900/70" : "text-neutral-500"}`}>{t.hint}</span>
          </button>
        ))}
      </nav>
      {status && <span className="text-[11px] text-neutral-400">{status}</span>}
      <div className="ml-auto" />
      <InstallButton />
      <Link
        to="/find"
        className="flex items-center gap-1.5 rounded-md border border-green-500/60 px-3 py-1.5 text-xs text-green-300 hover:bg-green-500/10"
      >
        <Navigation className="h-3.5 w-3.5" /> Find my car
      </Link>
    </header>
  );
}
