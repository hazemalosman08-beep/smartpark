// Complex mode, end to end: a camera maps its own lot as always (the tilted
// picture), the satellite picture of the whole place is added (the drone
// picture of the same lot), and the camera is placed on it with 6 ground
// point pairs (test/accuracy/tilted-to-drone.link.json). The camera's spaces
// and occupancy must land on the right places of the satellite picture:
// scored against the drone answer key.
//   npx vite --port 5200 & node test/e2e/complex.e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:5200";
const ACC = path.join(__dirname, "../accuracy");
const OUT = process.argv[2];
(async () => {
  const pairs = JSON.parse(fs.readFileSync(path.join(ACC, "tilted-to-drone.link.json")));
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("smartpark-photo"); });
  await p.reload();
  // 1. The camera, as always.
  await p.locator("input[type=file][accept='image/*,video/*']").setInputFiles(path.join(ACC, "tilted.png"));
  await p.getByText(/Found \d+ spaces/).first().waitFor({ timeout: 240000 });
  await p.waitForTimeout(2000);
  // 2. The satellite picture of the whole place.
  await p.locator("input[type=file][accept='image/*']").setInputFiles(path.join(ACC, "drone.png"));
  await p.getByRole("button", { name: /Place on map/ }).waitFor();
  // 3. Place the camera on it.
  await p.getByRole("button", { name: /Place on map/ }).click();
  const imgs = p.locator("div.fixed img");
  await imgs.first().waitFor();
  const cam = await imgs.nth(0).boundingBox(), site = await imgs.nth(1).boundingBox();
  for (const pr of pairs) {
    await p.mouse.click(cam.x + (cam.width * pr.from.x) / 100, cam.y + (cam.height * pr.from.y) / 100);
    await p.mouse.click(site.x + (site.width * pr.to.x) / 100, site.y + (site.height * pr.to.y) / 100);
  }
  if (OUT) await p.screenshot({ path: path.join(OUT, "complex_place.png") });
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => window.__smartparkComplex());
  // 4. The whole complex in 3D.
  await p.getByRole("button", { name: /See complex in 3D/ }).click();
  await p.waitForTimeout(6000);
  await p.getByRole("button", { name: /Bird/ }).click().catch(() => {});
  await p.waitForTimeout(3500);
  if (OUT) await p.screenshot({ path: path.join(OUT, "complex_3d.png") });
  await b.close();
  const { score } = await import("../accuracy/score.mjs");
  const s = score(JSON.parse(fs.readFileSync(path.join(ACC, "drone.truth.json"))), r);
  console.log(`complex: ${r.stalls.length} spaces placed | answer key spaces ${s.spaces.found}/${s.spaces.truth} | occupancy ${s.occupancy.correct}/${s.occupancy.checked}${s.occupancy.wrong.length ? ` (wrong: ${s.occupancy.wrong.join(", ")})` : ""} | lots ${JSON.stringify(r.areas.map((a) => [a.name, a.open, a.total]))}`);
  console.log("errors:", errors);
  if (s.spaces.found < 70 || s.occupancy.correct < s.occupancy.checked - 2 || errors.length) { console.log("FAILED"); process.exit(1); }
  console.log("complex e2e ok");
})();
