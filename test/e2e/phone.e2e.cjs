// Phone-as-camera check: one browser is the computer, another the phone (with a
// fake camera playing test/e2e/drive.y4m). Needs a PeerJS broker and the dev server:
//   node peer-server (port 9000), then
//   VITE_PEER_HOST=127.0.0.1 VITE_PEER_PORT=9000 VITE_PEER_PATH=/ VITE_PEER_SECURE=false npx vite --port 5199
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:5199';
const OUT = (process.env.OUT_DIR || __dirname) + '/';
const VIDEO = process.env.FAKE_VIDEO || path.join(__dirname, 'drive.y4m');
(async () => {
  const errors = [];
  const computer = await chromium.launch();
  const phone = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO}`] });
  const pc = await computer.newPage({ viewport: { width: 1440, height: 900 } });
  pc.on('pageerror', (e) => errors.push('computer: ' + e.message));
  await pc.goto(BASE + '/');
  await pc.getByRole('button', { name: 'Phone camera' }).first().click();
  await pc.getByText('Waiting for your phone').first().waitFor({ timeout: 20000 });
  const code = (await pc.locator('p.font-mono').first().innerText()).replace(/\D/g, '');
  console.log('code shown on computer:', code);
  await pc.screenshot({ path: OUT + 'pair_dialog.png' });

  const ph = await (await phone.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  ph.on('pageerror', (e) => errors.push('phone: ' + e.message));
  await ph.goto(`${BASE}/phone-camera?code=${code}`);
  await ph.getByRole('button', { name: 'Start camera' }).click();
  await ph.getByText('Streaming to the computer').waitFor({ timeout: 30000 });
  console.log('phone: streaming');
  await ph.screenshot({ path: OUT + 'phone_streaming.png' });

  await pc.waitForFunction(() => /[1-9][0-9]* vehicles/.test(document.body.innerText), null, { timeout: 180000 });
  await pc.waitForTimeout(3000);
  console.log('computer:', (await pc.locator('text=/vehicles/').first().innerText()));
  await pc.screenshot({ path: OUT + 'computer_phone_feed.png' });
  console.log('errors:', errors);
  await computer.close(); await phone.close();
})();
