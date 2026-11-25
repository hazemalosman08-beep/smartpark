// End-to-end UI check. Start the dev server first:
//   npx vite --port 5199
// then: node test/e2e/ui.e2e.cjs   (screenshots go next to this file, or to OUT_DIR)
const { chromium } = require('playwright');
const OUT = (process.env.OUT_DIR || __dirname) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:5199';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await p.goto('' + BASE + '/test/e2e/app.html');
  await p.getByText('Camera', { exact: false }).first().waitFor();
  // faster settings for the slow sandbox CPU
  await p.locator('select').first().selectOption('fast');
  await p.locator('select').nth(1).selectOption('off');
  await p.locator('input[type=file]').setInputFiles(__dirname + '/drive.mp4');
  await p.waitForFunction(() => /[1-9][0-9]* vehicles/.test(document.body.innerText), null, { timeout: 150000 });
  await p.waitForTimeout(3000);
  const stage = await p.locator('canvas').first().boundingBox();
  const at = (px, py) => ({ x: stage.x + (px / 864) * stage.width, y: stage.y + (py / 480) * stage.height });
  const click = async (px, py) => { const c = at(px, py); await p.mouse.click(c.x, c.y); };
  await p.getByRole('button', { name: 'Add row of spaces' }).click();
  await p.locator('input[type=number]').fill('6');
  for (const [x, y] of [[5, 365], [385, 365], [385, 300], [5, 300]]) await click(x, y);
  await p.getByRole('button', { name: 'More tools' }).click(); await p.getByRole('button', { name: 'Driving lane' }).click();
  await click(10, 470); await click(10, 378); await click(855, 378);
  await p.keyboard.press('Enter');
  await p.getByRole('button', { name: 'Entrance' }).click();
  await click(20, 465);
  await p.waitForTimeout(4000);
  await p.screenshot({ path: OUT + 'cam1.png' });
  console.log('counter:', await p.locator('text=/vehicles/').first().innerText());
  await p.getByRole('button', { name: /Lot/ }).first().click();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: OUT + 'lot_camera.png' });
  // wait into the "stopped" part of the clip and check the car's state
  await p.waitForTimeout(9000);
  const spots = (await p.locator('section', { hasText: 'VEHICLES' }).innerText()).match(/in [A-Z]+\d+/g) || [];
  console.log('spot labels', spots.length, 'unique', new Set(spots).size === spots.length);
  await p.screenshot({ path: OUT + 'lot_camera2.png' });
  console.log('vehicles panel:', (await p.locator('section', { hasText: 'VEHICLES' }).innerText()).replace(/\n/g, ' | ').slice(0, 600));
  console.log('activity:', (await p.locator('section', { hasText: 'ACTIVITY' }).innerText()).replace(/\n/g, ' | ').slice(0, 600));
  // true-to-scale: set the lot corners
  await p.getByRole('button', { name: /Camera/ }).first().click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Lot corners' }).click();
  await p.locator('input[type=number]').first().fill('90'); await p.locator('input[type=number]').nth(1).fill('45');
  for (const [x, y] of [[2, 205], [860, 245], [860, 477], [2, 477]]) await click(x, y);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + 'cam_ground.png' });
  await p.getByRole('button', { name: /Lot/ }).first().click();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: OUT + 'lot_rectified.png' });
  // sample lot + simulation in a fresh browser profile
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const q = await ctx2.newPage();
  q.on('pageerror', e => errors.push('sim pageerror: ' + e.message));
  await q.goto('' + BASE + '/test/e2e/app.html');
  await q.getByRole('button', { name: /Lot/ }).first().click();
  await q.getByRole('button', { name: 'Load sample lot' }).click();
  await q.waitForTimeout(6000);
  await q.screenshot({ path: OUT + 'lot_sim.png' });
  await q.setViewportSize({ width: 390, height: 844 });
  await q.waitForTimeout(1000);
  await q.screenshot({ path: OUT + 'lot_sim_phone.png', fullPage: true });
  console.log('errors:', errors.slice(0, 10));
  await b.close();
})();
