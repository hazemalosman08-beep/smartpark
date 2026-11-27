// Site map + linked camera, end to end (Phase 1).
// The drone picture becomes the site map; the tilted picture (the same lot
// from a pole camera) is linked to it with 6 ground point pairs (found once
// with feature matching, stored in test/accuracy/tilted-to-drone.link.json).
// What the camera sees must land on the right site spaces: scored against the
// drone answer key. Fails below 79/81 (the two misses are cars the detector
// does not see in this camera).
//   npx vite --port 5200 & node test/e2e/site.e2e.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:5200";
const ACC = path.join(__dirname, "../accuracy");
(async () => {
  const pairs = JSON.parse(fs.readFileSync(path.join(ACC, "tilted-to-drone.link.json")));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("smartpark-photo"); });
  await p.reload();
  await p.locator("input[type=file]").setInputFiles(path.join(ACC, "drone.png"));
  await p.getByText(/Found \d+ spaces/).first().waitFor({ timeout: 240000 });
  await p.waitForTimeout(2000);
  await p.getByRole("button", { name: "Make this picture the site map" }).click();
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: "Camera", exact: true }).click();
  await p.locator("input[type=file]").setInputFiles(path.join(ACC, "tilted.png"));
  await p.waitForFunction(() => /[1-9]\d* vehicles/.test(document.body.innerText), null, { timeout: 240000 });
  await p.waitForTimeout(8000);
  await p.getByRole("button", { name: /Link camera/ }).click();
  const imgs = p.locator("div.fixed img");
  await imgs.first().waitFor();
  const cam = await imgs.nth(0).boundingBox(), site = await imgs.nth(1).boundingBox();
  for (const pr of pairs) {
    await p.mouse.click(cam.x + (cam.width * pr.from.x) / 100, cam.y + (cam.height * pr.from.y) / 100);
    await p.mouse.click(site.x + (site.width * pr.to.x) / 100, site.y + (site.height * pr.to.y) / 100);
  }
  await p.getByRole("button", { name: "Save link" }).click();
  await p.waitForTimeout(12000);
  const r = await p.evaluate(() => window.__smartparkSite());
  await b.close();
  const { score } = await import("../accuracy/score.mjs");
  const s = score(JSON.parse(fs.readFileSync(path.join(ACC, "drone.truth.json"))), r);
  console.log(`site map via linked camera: link error ${r.link?.error}% | spaces ${s.spaces.found}/${s.spaces.truth} | occupancy ${s.occupancy.correct}/${s.occupancy.checked}${s.occupancy.wrong.length ? ` (wrong: ${s.occupancy.wrong.join(", ")})` : ""}`);
  console.log("errors:", errors);
  if (r.mode !== "camera" || s.occupancy.correct < 79 || errors.length) { console.log("FAILED"); process.exit(1); }
  console.log("site e2e ok");
})();
