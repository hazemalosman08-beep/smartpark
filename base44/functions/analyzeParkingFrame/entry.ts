import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import verifyVehicleRegions from './verifyVehicleRegions.ts';
import locateVehicleCenters from '../../shared/vehicleCenters.ts';

// Only frames this app uploaded may be analyzed (no arbitrary URL proxying).
const ALLOWED_URL = /^https:\/\/[a-z0-9.-]*base44\.(com|app)\//i;
// A private upload comes back as a storage key in more than one shape, so any
// non-URL storage reference is read from private storage; only app storage URLs
// are accepted as URLs (never arbitrary internet links).
const isPrivateImage = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 1200 &&
  !value.includes('..') &&
  !/^[a-z][a-z0-9+.-]*:/i.test(value);

const MAX_CELLS = 400;
const CAR_OVERLAP = 0.5;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const CAR_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'short vehicle type: car, truck, bus' },
    x: { type: 'number', description: 'left edge as percent of frame width, 0-100' },
    y: { type: 'number', description: 'top edge as percent of frame height, 0-100' },
    w: { type: 'number', description: 'box width as percent of frame width, 0-100' },
    h: { type: 'number', description: 'box height as percent of frame height, 0-100' },
    confidence: { type: 'number' },
  },
};

const SPOT_SCHEMA = {
  type: 'object',
  properties: {
    row: { type: 'string' },
    index: { type: 'number' },
    status: { type: 'string', enum: ['free', 'occupied', 'blocked', 'predicted'] },
    confidence: { type: 'number' },
    x: { type: 'number', description: 'center x as percent of frame width, 0-100' },
    y: { type: 'number', description: 'center y as percent of frame height, 0-100' },
  },
};

const STALL_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'number', description: 'the stall number you were given' },
    status: { type: 'string', enum: ['occupied', 'free'] },
  },
};

const refText = (box) =>
  `x=${box.x.toFixed(1)} y=${box.y.toFixed(1)} w=${box.w.toFixed(1)} h=${box.h.toFixed(1)}`;

function buildPrompt({ width, height, cells, spotBox, occupiedBox }) {
  const size = width > 0 && height > 0 ? ` The frame is ${width} by ${height} pixels.` : '';
  const vehicleTask = `1) VEHICLES: Find every vehicle you can see (car, SUV, pickup, truck, van, bus). For each one return a tight bounding box around the vehicle as PERCENTAGES of the frame (0-100, never pixels): x = left edge, y = top edge, w = box width, h = box height, a short label ("car", "truck", "bus") and confidence 0-1. Only include clear vehicles — ignore people, carts, signs, shadows, reflections and empty pavement. Never invent a vehicle for an empty stall.`;

  if (!cells.length) {
    return `You are a parking-lot vision system looking at one camera frame.${size}

${vehicleTask}

2) SPOTS: Also map the parking stalls: each stall's row letter (A, B, C... top to bottom), its index within that row (1, 2, 3... left to right), whether it is occupied (a vehicle is parked in it), free, or blocked, its confidence 0-1, and the stall center as PERCENTAGES of the frame (x, y, 0-100).

All values are percentages of the frame size, never pixel coordinates. Be exhaustive and precise — the coordinates are drawn directly over the video.`;
  }

  const stallList = cells
    .map(
      (c, i) =>
        `#${i + 1}: x=${c.x.toFixed(1)} y=${c.y.toFixed(1)} w=${c.w.toFixed(1)} h=${c.h.toFixed(1)}`
    )
    .join('\n');

  const emptyRef = spotBox
    ? `\nA stall on this frame that is EMPTY (vacant, no vehicle) is at ${refText(spotBox)}.`
    : '';
  const fullRef = occupiedBox
    ? `\nA stall on this frame that is FULL (a vehicle is parked in it) is at ${refText(occupiedBox)}.`
    : '';

  return `You are a parking-lot vision system looking at one camera frame.${size}

${vehicleTask}

2) STALLS: This lot is already mapped as ${cells.length} parking stalls, listed below as percentages of the frame (x, y = top-left corner of the stall, w, h = its size). Decide for EACH stall whether a vehicle is parked in it right now: "occupied" when a vehicle body sits in that stall, "free" when the stall shows empty pavement or only painted markings.

How to judge each stall:
- Look only at what is inside that stall rectangle. Empty pavement, asphalt texture, painted lines, shadows, curbs or the gap between two cars mean "free".
- A stall is "occupied" only when a vehicle's body clearly sits in it.
- In a typical lot many stalls are empty: never assume a stall is occupied because its neighbours are, and never mark every stall occupied.
- Your two answers must agree: a stall is "occupied" only where one of the vehicles you listed is parked.
- Go stall by stall in order and give each one its own answer.${emptyRef}${fullRef}

Stalls:
${stallList}

Return exactly one entry per stall, using its number as id.

All values are percentages of the frame size, never pixel coordinates. Be exhaustive and precise.`;
}

function normalizeBoxes(raw, width, height) {
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || ![c.x, c.y, c.w, c.h].every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
    const values = [c.x, c.y, c.w, c.h];
    const inPixels = values.some((v) => v > 100) && width > 0 && height > 0;
    const [x, y, w, h] = inPixels
      ? [(values[0] / width) * 100, (values[1] / height) * 100, (values[2] / width) * 100, (values[3] / height) * 100]
      : values;
    if (w <= 0 || h <= 0 || x >= 100 || y >= 100 || x + w <= 0 || y + h <= 0) continue;
    const left = clamp(x, 0, 100), top = clamp(y, 0, 100);
    const right = clamp(x + w, 0, 100), bottom = clamp(y + h, 0, 100);
    if (right <= left || bottom <= top) continue;
    out.push({
      label: typeof c.label === 'string' && c.label ? c.label : 'car',
      x: left, y: top, w: right - left, h: bottom - top,
      confidence: Number.isFinite(c.confidence) ? clamp(c.confidence, 0, 1) : null,
    });
  }
  return out;
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const overlap = (x2 - x1) * (y2 - y1);
  return overlap / (a.w * a.h + b.w * b.h - overlap);
};

// The model sometimes reports the same vehicle twice (a box around the car and a
// second, looser box around it or a group of neighbours). Those duplicates became
// two tracks with two IDs on the video, so only the most confident box survives.
function mergeDuplicates(boxes) {
  const kept = [];
  for (const box of [...boxes].sort((a, b) => (b.confidence || 0) - (a.confidence || 0))) {
    const duplicate = kept.some((other) => {
      const overlap = iou(box, other);
      const insideOther = iou(box, other) > 0;
      const containment =
        insideOther &&
        Math.min(box.w * box.h, other.w * other.h) / Math.max(box.w * box.h, other.w * other.h);
      // Same car seen twice: heavy overlap, or one box nearly swallowing the other.
      return overlap >= 0.55 || (containment >= 0.85 && overlap >= 0.3);
    });
    if (!duplicate) kept.push(box);
  }
  return kept;
}

function normalizeSpots(raw, width, height) {
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const x = Number(s.x);
    const y = Number(s.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const inPixels = (x > 100 || y > 100) && width > 0 && height > 0;
    out.push({
      row: typeof s.row === 'string' && s.row ? s.row : 'A',
      index: Number(s.index) || out.length + 1,
      status: s.status || 'free',
      confidence: Number(s.confidence) || null,
      x: clamp(inPixels ? (x / width) * 100 : x, 0, 100),
      y: clamp(inPixels ? (y / height) * 100 : y, 0, 100),
    });
  }
  return out;
}

// A rectangle drawn on the frame, in percent, or null.
function sanitizeBox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return {
    x: clamp(x, 0, 100),
    y: clamp(y, 0, 100),
    w: clamp(w, 0.5, 100),
    h: clamp(h, 0.5, 100),
  };
}

function overlapRatio(car, cell) {
  const x1 = Math.max(car.x, cell.x);
  const y1 = Math.max(car.y, cell.y);
  const x2 = Math.min(car.x + car.w, cell.x + cell.w);
  const y2 = Math.min(car.y + car.h, cell.y + cell.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return ((x2 - x1) * (y2 - y1)) / (cell.w * cell.h);
}

// Tile the reference spot size across every boundary — the same math the preview
// uses, so stall numbering matches the overlay exactly.
function buildCells(spotBox, boundaries) {
  const sw = spotBox.w;
  const sh = spotBox.h;
  const cells = [];
  let rowIndex = 0;

  for (const area of boundaries) {
    const cols = Math.max(1, Math.floor(area.w / sw));
    const rows = Math.max(1, Math.floor(area.h / sh));
    const x0 = area.x + (area.w - cols * sw) / 2;
    const y0 = area.y + (area.h - rows * sh) / 2;

    for (let r = 0; r < rows; r++) {
      const letter = String.fromCharCode(65 + (rowIndex % 26));
      for (let c = 0; c < cols; c++) {
        if (cells.length >= MAX_CELLS) return cells;
        cells.push({
          row: letter,
          index: c + 1,
          x: x0 + c * sw,
          y: y0 + r * sh,
          w: sw,
          h: sh,
        });
      }
      rowIndex++;
    }
  }
  return cells;
}

// Each stall follows the model's own verdict; a detected vehicle only decides
// the stalls the model left unanswered.
function buildSpots(cells, cars, rawStalls) {
  const modelStatus = new Map();
  for (const s of Array.isArray(rawStalls) ? rawStalls : []) {
    const id = Number(s?.id);
    if (!Number.isInteger(id) || id < 1 || id > cells.length) continue;
    if (s.status === 'occupied' || s.status === 'free') modelStatus.set(id, s.status);
  }

  return cells.map((cell, i) => {
    const verdict = modelStatus.get(i + 1);
    const carHit = cars.some((car) => overlapRatio(car, cell) >= CAR_OVERLAP);
    const occupied = verdict ? verdict === 'occupied' : carHit;
    return {
      row: cell.row,
      index: cell.index,
      status: occupied ? 'occupied' : 'free',
      confidence: null,
      x: cell.x + cell.w / 2,
      y: cell.y + cell.h / 2,
      w: cell.w,
      h: cell.h,
    };
  });
}

export default async function (req) {
  try {
    const body = await req.json().catch(() => ({}));
    const fileUri = typeof body?.file_uri === 'string' ? body.file_uri : '';
    const privateImage = isPrivateImage(fileUri);
    if (body?.candidate_count !== undefined) {
      const count = body.candidate_count;
      if (!Number.isInteger(count) || count < 1 || count > 40 || !privateImage) {
        return Response.json({ error: 'Provide a private region sheet and 1-40 numbered regions' }, { status: 400 });
      }
      return await verifyVehicleRegions(createClientFromRequest(req), fileUri, count);
    }
    const fileUrl = typeof body?.file_url === 'string' ? body.file_url : '';
    // Live camera frames stay in private storage and are read straight from it.
    const usePrivateFrame = privateImage;
    if (!usePrivateFrame && (!fileUrl || !ALLOWED_URL.test(fileUrl))) {
      return Response.json({ error: 'file_url must be an image uploaded by this app' }, { status: 400 });
    }

    const width = Number(body?.width) || 0;
    const height = Number(body?.height) || 0;
    const layoutOnly = body?.layout_only === true;
    const carsOnly = body?.cars_only === true;

    const spotBox = sanitizeBox(body?.spot_box);
    const occupiedBox = sanitizeBox(body?.occupied_box);
    const boundaries = (Array.isArray(body?.boundaries) ? body.boundaries : [])
      .map(sanitizeBox)
      .filter(Boolean)
      .slice(0, 12);
    const calibrated = Boolean(spotBox && boundaries.length);
    const cells = calibrated ? buildCells(spotBox, boundaries) : [];

    const base44 = createClientFromRequest(req);
    if (carsOnly) {
      const cars = await locateVehicleCenters(base44, usePrivateFrame ? fileUri : fileUrl);
      return Response.json({ cars, spots: [], calibrated: false });
    }

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: layoutOnly
        ? 'Map only the visible painted parking-space layout in this image. Return spots with row letters top to bottom, index left to right, and x/y centers as percentages of the whole image (0-100). Include only actual parking spaces evidenced by markings or physical bay boundaries. Do not invent spaces to fit cars. Do not detect vehicles or judge occupancy; a separate object detector does that. Set status to free as a placeholder only. If no parking-space layout is visible, return an empty spots array.'
        : buildPrompt({ width, height, cells, spotBox, occupiedBox }),
      file_urls: [usePrivateFrame ? fileUri : fileUrl],
      response_json_schema: {
        type: 'object',
        properties: layoutOnly ? {
          spots: { type: 'array', items: SPOT_SCHEMA },
        } : {
          cars: { type: 'array', items: CAR_SCHEMA },
          stalls: { type: 'array', items: STALL_SCHEMA },
          spots: { type: 'array', items: SPOT_SCHEMA },
        },
      },
      add_context_from_internet: false,

    });

    const cars = layoutOnly ? [] : mergeDuplicates(normalizeBoxes(result?.cars, width, height));
    const spots = calibrated && !layoutOnly
      ? buildSpots(cells, cars, result?.stalls)
      : normalizeSpots(result?.spots, width, height);

    return Response.json({ cars, spots, calibrated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}