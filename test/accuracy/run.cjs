// Loads a picture into the running dev app, waits for automatic space finding,
// saves what the app decided, and scores it.
//   npx vite --port 5200   (in another terminal)
//   node test/accuracy/run.cjs test/accuracy/garage.truth.json [out.json]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const truthPath = path.resolve(process.argv[2]);
  const truth = JSON.parse(fs.readFileSync(truthPath));
  const img = path.join(path.dirname(truthPath), truth.image);
  const out = process.argv[3] || truthPath.replace(".truth.json", ".app.json");
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  await p.goto(process.env.BASE_URL || "http://localhost:5200/");
  await p.locator("input[type=file]").setInputFiles(img);
  await p.getByText(/Found \d+ spaces|No spaces found/).first().waitFor({ timeout: 240000 });
  await p.waitForTimeout(3000);
  const app = await p.evaluate(() => window.__smartparkLive());
  fs.writeFileSync(out, JSON.stringify(app));
  await b.close();
  const { score } = await import("./score.mjs");
  const r = score(truth, app);
  const s = r.spaces, o = r.occupancy;
  if (!truth.spaces.length) {
    console.log(`${truth.image}: ${app.vehicles} cars | app ${s.appTotal} spaces, ${o.appTaken} taken | overlapping pairs ${s.overlaps} (unlabelled picture)`);
    return;
  }
  console.log(`${truth.image}: ${app.vehicles} cars | overlapping pairs ${s.overlaps} | spaces ${s.found}/${s.truth} found, ${s.missed} missed, ${s.duplicates} duplicates, ${s.extra} extra (app total ${s.appTotal}) | occupancy ${o.correct}/${o.checked} right, app says ${o.appTaken} taken vs ${o.truthTaken} truly taken`);
  if (o.wrong.length) console.log("  wrong:", o.wrong.join(", "));
})();
