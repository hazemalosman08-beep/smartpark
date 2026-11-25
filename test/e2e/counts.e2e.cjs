// Checks that the camera counter, the Lot tab and the Driver screen show the
// same numbers, also while the Lot tab's Guide demo is running.
//   npx vite --port 5200, then node test/e2e/counts.e2e.cjs [picture]
const { chromium } = require("playwright");
const path = require("path");
const IMG = process.argv[2] || path.join(__dirname, "../accuracy/garage.png");
const num = (t, re) => Number((t.match(re) || [])[1]);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.BASE_URL || "http://localhost:5200/");
  await p.locator("input[type=file]").setInputFiles(IMG);
  await p.getByText(/Found \d+ spaces/).first().waitFor({ timeout: 240000 });
  await p.waitForTimeout(3000);
  const badge = (await p.locator("div.pointer-events-none.absolute.right-3.top-3").innerText()).replace(/\n/g, " ");
  const cam = { total: num(badge, /(\d+) SPACES/i), open: num(badge, /(\d+) OPEN/i), taken: num(badge, /(\d+) TAKEN/i) };
  await p.getByRole("button", { name: /Lot/ }).first().click(); await p.waitForTimeout(1500);
  const read = async () => {
    const t = (await p.locator("section", { hasText: "OCCUPANCY" }).innerText()).replace(/\n/g, " ");
    return { total: num(t, /(\d+) STALLS/i), open: num(t, /(\d+) FREE/i), taken: num(t, /(\d+) TAKEN/i), pct: num(t, /(\d+)%/) };
  };
  const lot = await read();
  await p.getByRole("button", { name: /Guide demo/ }).click();
  await p.getByRole("button", { name: /Car arrives/ }).click();
  await p.waitForTimeout(3000);
  const lotDemo = await read();
  await p.getByRole("button", { name: /Driver/ }).click(); await p.waitForTimeout(1000);
  const d = (await p.locator("aside").first().innerText()).replace(/\n/g, " ");
  const drv = { open: num(d, /available\s+(\d+)/i), total: num(d, /of (\d+)/), pct: num(d, /(\d+)% occupied/) };
  console.log(JSON.stringify({ cam, lot, lotDemo, drv }));
  const same = cam.total === lot.total && lot.total === lotDemo.total && lot.total === drv.total &&
    cam.open === lot.open && lot.open === lotDemo.open && lot.open === drv.open && lot.pct === drv.pct && lot.pct === lotDemo.pct;
  console.log(same ? "COUNTS MATCH on every screen" : "MISMATCH", errors.length ? errors : "");
  await b.close();
  process.exit(same ? 0 : 1);
})();
