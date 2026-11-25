import React from "react";
import { Link } from "react-router-dom";

function CtrlButton({ children, active, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-3 py-1.5 rounded border transition-colors ${
        active
          ? "border-green-500 text-green-400 bg-green-500/10"
          : "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Hint({ label, children }) {
  return (
    <span className="flex items-baseline gap-1.5 text-xs leading-relaxed text-neutral-400">
      <span className="font-semibold text-green-400">{label}</span>
      <span className="text-neutral-500">·</span>
      <span>{children}</span>
    </span>
  );
}

export default function TopBar({ view, setView, addSpots, setAddSpots, onLoadPhoto, onClearSpots, onDetect, detecting, onPresent }) {
  return (
    <header className="border-b border-neutral-800 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold tracking-widest text-green-400">SMARTPARK</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <CtrlButton onClick={onLoadPhoto}>Load photo</CtrlButton>
          <CtrlButton active={view === "photo"} onClick={() => setView("photo")}>Photo</CtrlButton>
          <CtrlButton active={view === "live"} onClick={() => setView("live")}>Live</CtrlButton>
          <CtrlButton active={view === "split"} onClick={() => setView("split")}>Split</CtrlButton>
          <CtrlButton active={view === "grid"} onClick={() => setView("grid")}>Grid</CtrlButton>
          <CtrlButton active={view === "guide"} onClick={() => setView("guide")}>Guide</CtrlButton>
          <CtrlButton active={view === "twin"} onClick={() => setView("twin")}>Twin</CtrlButton>
          <CtrlButton active={addSpots} onClick={() => setAddSpots((v) => !v)}>
            Add spots: {addSpots ? "ON" : "OFF"}
          </CtrlButton>
          <CtrlButton onClick={onClearSpots}>Clear spots</CtrlButton>
          <CtrlButton onClick={onDetect} disabled={detecting}>
            {detecting ? "Detecting…" : "Detect spots"}
          </CtrlButton>
          <CtrlButton onClick={onPresent}>Exit Present</CtrlButton>
          <Link
            to="/find"
            className="text-xs px-3 py-1.5 rounded border border-green-500/60 text-green-300 hover:bg-green-500/10"
          >
            Find car app
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2">
        <Hint label="Load a lot">
          Paste a photo (Ctrl/Cmd+V) or use <b className="text-neutral-200">Load photo</b>
        </Hint>
        <Hint label="Add a spot">Click the photo</Hint>
        <Hint label="Change status">
          Click a spot to cycle Free → Occupied → Blocked
        </Hint>
        <Hint label="Delete a spot">Shift+click it</Hint>
        <Hint label="Rows">Letter automatically from the photo position</Hint>
        <Hint label="Present">Fullscreen; press Esc to get the controls back</Hint>
      </div>
    </header>
  );
}