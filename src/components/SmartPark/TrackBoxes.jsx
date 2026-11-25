import React from "react";
import TrackLabels from "@/components/SmartPark/TrackLabels";

// Camera/photo overlays are ID labels only, centered directly on each vehicle.
export default function TrackBoxes({ tracks = [] }) {
  const visible = tracks.filter((track) => track.vehicle_id && track.status !== "unknown" && !(track.missed > 0));
  return <TrackLabels tracks={visible} />;
}