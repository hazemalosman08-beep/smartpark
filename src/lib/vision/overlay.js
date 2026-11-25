// Canvas drawing for the camera view: stalls, lanes, ground plane, vehicles.
// All inputs are in camera percent; the canvas is the size of the shown picture.

export function idColor(id = "", alpha = 1) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsla(${(h * 47) % 360}, 85%, 60%, ${alpha})`;
}

const STALL_TONE = {
  free: { stroke: "rgba(74,222,128,0.95)", fill: "rgba(74,222,128,0.16)" },
  occupied: { stroke: "rgba(248,113,113,0.95)", fill: "rgba(248,113,113,0.22)" },
  changing: { stroke: "rgba(250,204,21,0.95)", fill: "rgba(250,204,21,0.18)" },
  none: { stroke: "rgba(255,255,255,0.75)", fill: "rgba(255,255,255,0.06)" },
};

export function drawOverlay(ctx, { width, height, calibration, statuses, tracks = [], pending = [], draft = null, now = Date.now(), showStalls = true, highlight = null, lotToCamera = null }) {
  const sx = width / 100, sy = height / 100;
  const P = (p) => [p.x * sx, p.y * sy];
  ctx.clearRect(0, 0, width, height);
  ctx.lineJoin = "round";
  const font = Math.max(10, Math.min(14, width / 70));

  // Ground calibration
  const quad = calibration?.ground?.auto ? null : calibration?.ground?.quad;
  if (quad?.length === 4) {
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(56,189,248,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Lanes
  (calibration?.lanes || []).forEach((lane) => {
    ctx.strokeStyle = "rgba(96,165,250,0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    lane.points.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    ctx.stroke();
    ctx.setLineDash([]);
    const a = lane.points[lane.points.length - 2], b = lane.points[lane.points.length - 1];
    arrow(ctx, P(a), P(b), "rgba(96,165,250,0.95)");
  });

  // Stalls
  if (showStalls) {
    (calibration?.stalls || []).forEach((stall) => {
      const st = statuses?.get?.(stall.id);
      const tone = !st ? STALL_TONE.none : st.changing ? STALL_TONE.changing : STALL_TONE[st.status] || STALL_TONE.none;
      ctx.beginPath();
      stall.poly.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
      ctx.closePath();
      ctx.fillStyle = tone.fill;
      ctx.fill();
      ctx.strokeStyle = highlight === stall.id ? "#fff" : tone.stroke;
      ctx.lineWidth = highlight === stall.id ? 3 : 1.5;
      ctx.stroke();
      const c = stall.poly.reduce((s, p) => ({ x: s.x + p.x / stall.poly.length, y: s.y + p.y / stall.poly.length }), { x: 0, y: 0 });
      const tag = stall.kind === "accessible" ? `♿ ${stall.label}` : stall.kind === "reserved" ? `R ${stall.label}` : stall.label;
      if (stall.kind) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = stall.kind === "accessible" ? "#60a5fa" : "#a78bfa";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      label(ctx, tag, c.x * sx, c.y * sy, stall.kind === "accessible" ? "#60a5fa" : stall.kind === "reserved" ? "#a78bfa" : tone.stroke, font * 0.8, "#0b0f0b");
    });
  }

  // Building outlines drawn by hand
  (calibration?.footprints || []).forEach((f) => {
    ctx.beginPath();
    f.points.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    ctx.closePath();
    ctx.fillStyle = "rgba(251,191,36,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(251,191,36,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  [calibration?.building && { ...calibration.building, name: "BUILDING" }, ...(calibration?.buildings || [])].filter(Boolean).forEach((b) => {
    const [x, y] = P(b);
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(x - 7, y - 7, 14, 14);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 7, y - 7, 14, 14);
    label(ctx, String(b.name || "BUILDING").toUpperCase(), x, y - 16, "#fbbf24", font * 0.8, "#000");
  });

  ["entrance", "exit"].forEach((kind) => {
    const p = calibration?.[kind];
    if (!p) return;
    const [x, y] = P(p);
    ctx.fillStyle = kind === "entrance" ? "#4ade80" : "#f472b6";
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, kind === "entrance" ? "IN" : "OUT", x, y - 14, ctx.fillStyle, font * 0.8, "#000");
  });

  // Vehicles being acquired (not yet confirmed)
  pending.forEach((t) => {
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(t.x * sx, t.y * sy, t.w * sx, t.h * sy);
    ctx.setLineDash([]);
  });

  // Tracked vehicles, extrapolated to "now" between detector frames.
  tracks.forEach((t) => {
    const lost = t.state === "lost";
    const age = Math.min(0.6, Math.max(0, (now - (t.last_seen || now)) / 1000));
    const dx = lost ? 0 : (t.velocity_x || 0) * age;
    const dy = lost ? 0 : (t.velocity_y || 0) * age;
    const x = (t.x + dx) * sx, y = (t.y + dy) * sy, w = t.w * sx, h = t.h * sy;
    const color = idColor(t.vehicle_id, lost ? 0.45 : 1);
    // trail (stored in lot space)
    if (lotToCamera && t.trail?.length > 2 && t.motion !== "parked") {
      ctx.strokeStyle = idColor(t.vehicle_id, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      t.trail.forEach((p, i) => {
        const c = lotToCamera(p);
        i ? ctx.lineTo(c.x * sx, c.y * sy) : ctx.moveTo(c.x * sx, c.y * sy);
      });
      ctx.stroke();
    }
    ctx.setLineDash(lost ? [4, 4] : []);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    cornerBox(ctx, x, y, w, h);
    ctx.setLineDash([]);
    const tag = `${t.vehicle_id}${t.motion === "parked" && t.spot_label ? ` · ${t.spot_label}` : t.motion === "moving" ? ` · ${Math.round((t.speed || 0) * 3.6)} km/h` : ""}`;
    label(ctx, tag, x + w / 2, Math.max(font, y - font * 0.7), color, font, "#000");
  });

  // Draft (tool being drawn)
  if (draft?.points?.length) {
    ctx.strokeStyle = draft.color || "#facc15";
    ctx.fillStyle = draft.color || "#facc15";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
    pts.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    if (draft.closed && pts.length > 2) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    draft.points.forEach((p, i) => {
      const [x, y] = P(p);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      if (draft.labels?.[i]) label(ctx, draft.labels[i], x, y - 12, draft.color || "#facc15", font * 0.75, "#000");
    });
    (draft.preview || []).forEach((poly) => {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
      ctx.closePath();
      ctx.stroke();
    });
  }
}

function cornerBox(ctx, x, y, w, h) {
  const c = Math.min(w, h) * 0.28;
  ctx.beginPath();
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
  ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

function label(ctx, text, x, y, bg, size, fg) {
  if (!text) return;
  ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const w = ctx.measureText(text).width + 8;
  const h = size + 4;
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = bg;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = bg === "#000" ? fg : bg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
}

function arrow(ctx, [ax, ay], [bx, by], color) {
  const angle = Math.atan2(by - ay, bx - ax);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - 12 * Math.cos(angle - 0.45), by - 12 * Math.sin(angle - 0.45));
  ctx.lineTo(bx - 12 * Math.cos(angle + 0.45), by - 12 * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}
