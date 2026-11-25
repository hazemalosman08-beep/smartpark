// Pretrained YOLOv8 object detection, not generated coordinates or stall guesses.
// Pinned model weights run locally using the TensorFlow.js already in this app.
const MODEL_URL = "https://raw.githubusercontent.com/Hyuto/yolov8-tfjs/b6a8bc691c0c1897802373d7da65dc889af1f451/public/yolov8n_web_model/model.json";
const LABELS = new Map([[2, "car"], [3, "motorcycle"], [5, "bus"], [7, "truck"]]);
const MIN_SCORE = 0.25;
let detectorPromise;
let inferenceTail = Promise.resolve();

export function loadYoloDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      const model = await tf.loadGraphModel(MODEL_URL);
      return { tf, model };
    })();
  }
  return detectorPromise;
}

function cropsFor(width, height) {
  const full = { x: 0, y: 0, w: width, h: height };
  // Give small and distant vehicles a close-up even on a 720p phone feed.
  const cols = width >= 480 ? Math.min(3, Math.max(2, Math.ceil(width / 768))) : 1;
  const rows = height >= 360 ? Math.min(3, Math.max(2, Math.ceil(height / 768))) : 1;
  if (cols === 1 && rows === 1) return [full];
  const w = Math.ceil(width / (1 + (cols - 1) * 0.8));
  const h = Math.ceil(height / (1 + (rows - 1) * 0.8));
  const crops = [full];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      crops.push({ x: Math.round(col * (width - w) / Math.max(1, cols - 1)), y: Math.round(row * (height - h) / Math.max(1, rows - 1)), w, h });
    }
  }
  return crops;
}

function suppressDuplicates(cars) {
  const kept = [];
  for (const car of cars.sort((a, b) => b.score - a.score)) {
    const duplicate = kept.some((other) => {
      const intersection = Math.max(0, Math.min(car.x + car.w, other.x + other.w) - Math.max(car.x, other.x)) * Math.max(0, Math.min(car.y + car.h, other.y + other.h) - Math.max(car.y, other.y));
      const a = car.w * car.h;
      const b = other.w * other.h;
      return intersection / (a + b - intersection) > 0.45 || (Math.min(a, b) / Math.max(a, b) > 0.6 && intersection / Math.min(a, b) > 0.85);
    });
    if (!duplicate) kept.push(car);
    if (kept.length === 200) break;
  }
  return kept;
}

async function inferCrop(detector, canvas, crop, width, height) {
  const { tf, model } = detector;
  const size = model.inputs[0].shape[1];
  const side = Math.max(canvas.width, canvas.height);
  const input = tf.tidy(() => {
    const pixels = tf.browser.fromPixels(canvas);
    const square = pixels.pad([[0, side - canvas.height], [0, side - canvas.width], [0, 0]]);
    return tf.image.resizeBilinear(square, [size, size]).div(255).expandDims(0);
  });
  let decoded;
  try {
    decoded = tf.tidy(() => {
      const output = model.execute(input); // [1, 84, 8400]: xywh + 80 COCO classes
      const boxes = output.slice([0, 0, 0], [1, 4, -1]).squeeze([0]);
      const classes = output.slice([0, 4, 0], [1, 80, -1]).squeeze([0]);
      return tf.concat([boxes, classes.max(0).expandDims(0), classes.argMax(0).toFloat().expandDims(0)], 0);
    });
    const values = await decoded.data();
    const count = decoded.shape[1];
    const scale = side / size;
    const cars = [];
    for (let i = 0; i < count; i += 1) {
      const score = values[4 * count + i];
      const label = LABELS.get(values[5 * count + i]);
      // A vehicle must be the winning class, not just a weak alternative to a person/sign.
      if (!label || score < MIN_SCORE) continue;
      const cx = values[i] * scale;
      const cy = values[count + i] * scale;
      const w = values[2 * count + i] * scale;
      const h = values[3 * count + i] * scale;
      if (cx < 0 || cy < 0 || cx >= crop.w || cy >= crop.h) continue;
      const x1 = Math.max(0, cx - w / 2);
      const y1 = Math.max(0, cy - h / 2);
      const x2 = Math.min(crop.w, cx + w / 2);
      const y2 = Math.min(crop.h, cy + h / 2);
      if (x2 <= x1 || y2 <= y1) continue;
      cars.push({ label, score, x: (crop.x + x1) / width * 100, y: (crop.y + y1) / height * 100, w: (x2 - x1) / width * 100, h: (y2 - y1) / height * 100 });
    }
    return cars;
  } finally {
    input.dispose();
    decoded?.dispose();
  }
}

async function inferFrame({ source, width, height }) {
  if (!source || !width || !height) return [];
  const detector = await loadYoloDetector();
  // Freeze once: all overlapping crops must describe the same instant of a live feed.
  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  frame.getContext("2d").drawImage(source, 0, 0, width, height);
  const canvas = document.createElement("canvas");
  const cars = [];
  for (const crop of cropsFor(width, height)) {
    canvas.width = crop.w;
    canvas.height = crop.h;
    canvas.getContext("2d").drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    cars.push(...await inferCrop(detector, canvas, crop, width, height));
  }
  return suppressDuplicates(cars);
}

export function detectYoloVehicles(frame) {
  const result = inferenceTail.then(() => inferFrame(frame));
  inferenceTail = result.catch(() => {});
  return result;
}