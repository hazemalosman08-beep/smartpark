// Regression suite: runs the app on every annotated lot and compares the
// scores with the recorded baseline. Fails (exit 1) if any lot got worse.
//   npm run test:accuracy               # starts its own dev server
//   npm run test:accuracy -- --update   # record the current scores as the baseline
//   BASE_URL=http://localhost:5200 npm run test:accuracy   # use a running server
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const DIR = __dirname;
const BASELINE = path.join(DIR, "baseline.json");
const update = process.argv.includes("--update");
const only = process.argv.filter((a) => a.endsWith(".truth.json"));

const waitFor = (url, ms) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => http.get(url, (r) => { r.resume(); resolve(); }).on("error", () => (Date.now() - t0 > ms ? reject(new Error(`no server at ${url}`)) : setTimeout(tick, 500)));
  tick();
});

async function main() {
  let server = null;
  let base = process.env.BASE_URL;
  if (!base) {
    const port = 5290;
    base = `http://localhost:${port}`;
    server = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: path.join(DIR, "../.."), stdio: "ignore", detached: true });
    await waitFor(base, 60000);
  }
  const { score } = await import("./score.mjs");
  const files = (only.length ? only.map((f) => path.resolve(f)) : fs.readdirSync(DIR).filter((f) => f.endsWith(".truth.json")).sort().map((f) => path.join(DIR, f)));
  const browser = await chromium.launch();
  const results = {};
  try {
    for (const file of files) {
      const truth = JSON.parse(fs.readFileSync(file));
      const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
      await page.goto(base);
      await page.locator("input[type=file]").setInputFiles(path.join(DIR, truth.image));
      await page.getByText(/Found \d+ spaces|No spaces found/).first().waitFor({ timeout: 240000 });
      await page.waitForTimeout(3000);
      const app = await page.evaluate(() => window.__smartparkLive());
      await page.close();
      const r = score(truth, app);
      const labelled = truth.spaces.length > 0;
      results[truth.image] = labelled
        ? { labelled, truth: r.spaces.truth, found: r.spaces.found, extra: r.spaces.extra, duplicates: r.spaces.duplicates, merged: r.spaces.merged, occupancyRight: r.occupancy.correct, occupancyChecked: r.occupancy.checked, accessibleFound: r.accessible?.found ?? null, accessibleWrong: r.accessible?.wrongly ?? null }
        : { labelled, appSpaces: r.spaces.appTotal, appTaken: r.occupancy.appTaken, cars: app.vehicles };
      const x = results[truth.image];
      console.log(labelled
        ? `${truth.image.padEnd(16)} spaces ${x.found}/${x.truth}  extra ${x.extra}  dup ${x.duplicates}  merged ${x.merged}  occupancy ${x.occupancyRight}/${x.occupancyChecked}${x.accessibleFound !== null ? `  accessible ${x.accessibleFound} (+${x.accessibleWrong} wrong)` : ""}`
        : `${truth.image.padEnd(16)} (no answer key) ${x.appSpaces} spaces, ${x.appTaken} taken, ${x.cars} cars`);
    }
  } finally {
    await browser.close();
    if (server) try { process.kill(-server.pid); } catch { /* already gone */ }
  }

  if (update) {
    const prev = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE)) : {};
    fs.writeFileSync(BASELINE, `${JSON.stringify({ ...prev, ...results }, null, 1)}\n`);
    console.log(`baseline written: ${BASELINE}`);
    return 0;
  }
  if (!fs.existsSync(BASELINE)) { console.log("no baseline yet: run with --update"); return 0; }
  const baseline = JSON.parse(fs.readFileSync(BASELINE));
  const problems = [], warnings = [];
  for (const [image, now] of Object.entries(results)) {
    const was = baseline[image];
    if (!was) { warnings.push(`${image}: not in the baseline yet`); continue; }
    if (now.labelled) {
      if (now.found < was.found) problems.push(`${image}: spaces found ${was.found} -> ${now.found}`);
      if (now.occupancyRight - now.occupancyChecked < was.occupancyRight - was.occupancyChecked) problems.push(`${image}: occupancy errors ${was.occupancyChecked - was.occupancyRight} -> ${now.occupancyChecked - now.occupancyRight}`);
      if (now.extra > was.extra + 1) problems.push(`${image}: extra spaces ${was.extra} -> ${now.extra}`);
      if (now.duplicates > was.duplicates || now.merged > was.merged) problems.push(`${image}: duplicates/merged ${was.duplicates}/${was.merged} -> ${now.duplicates}/${now.merged}`);
      if (was.accessibleFound !== null && (now.accessibleFound < was.accessibleFound || now.accessibleWrong > was.accessibleWrong)) problems.push(`${image}: accessible ${was.accessibleFound}(+${was.accessibleWrong}) -> ${now.accessibleFound}(+${now.accessibleWrong})`);
    } else {
      // No answer key: only large swings are reported (they need a look).
      const change = Math.abs(now.appSpaces - was.appSpaces) / Math.max(1, was.appSpaces);
      if (change > 0.15) warnings.push(`${image}: spaces ${was.appSpaces} -> ${now.appSpaces} (no answer key; check by eye)`);
    }
  }
  warnings.forEach((w) => console.log(`warning: ${w}`));
  if (problems.length) {
    problems.forEach((p) => console.log(`REGRESSION: ${p}`));
    return 1;
  }
  console.log("no regressions");
  return 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(2); });
