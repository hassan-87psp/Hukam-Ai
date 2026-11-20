// Browser end-to-end journey (Playwright): setup → pair → commands → approvals → emergency stop, desktop + mobile screenshots.
// Usage: start the relay with SETUP_CODE=DEMO-2026 on a fresh DATA_DIR, create sandbox folders, then:
//   HUKM_URL=http://localhost:8899 SANDBOX=/tmp/hukm-sandbox node tests/e2e/ui-journey.mjs
// The controller runs with HUKM_SIMULATE=1 (launches are logged, not performed).
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';

const BASE = process.env.HUKM_URL ?? 'http://localhost:8899';
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/screens';
const CTRL = new URL('../../apps/windows-controller', import.meta.url).pathname;
const env = { ...process.env, HUKM_SIMULATE: '1', HUKM_DATA_DIR: process.env.CTRL_DATA ?? '/tmp/hukm-ctrl' };
for (const k of ['Downloads', 'Documents', 'Desktop', 'Pictures', 'Music', 'Videos']) env[`HUKM_FOLDER_${k.toUpperCase()}`] = `${process.env.SANDBOX ?? '/tmp/hukm-sandbox'}/${k}`;
const log = (...a) => console.log('[e2e]', ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(BASE);
await page.getByLabel('Setup code').fill('DEMO-2026');
await page.getByLabel('Your name').fill('Hassan');
await page.getByLabel('Email').fill('hassan@hukm.pk');
await page.getByLabel('Password').fill('very-secure-pass');
await page.screenshot({ path: `${SHOTS}/01-setup.png` });
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByText('How can I help you today').waitFor();
log('account created');
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/02-dashboard-empty.png` });

// pair
await page.goto(BASE + '/devices');
await page.getByRole('button', { name: 'Pair new device' }).first().click();
await page.getByLabel('Device name (optional)').fill('HUKM-Laptop');
await page.getByRole('button', { name: 'Generate pairing code' }).click();
const code = (await page.locator('p.select-all').innerText()).trim();
log('pairing code', code);
await page.screenshot({ path: `${SHOTS}/03-pairing-code.png` });
execFileSync('python3', ['-m', 'controller', 'pair', '--server', BASE, '--code', code], { cwd: CTRL, env, stdio: 'inherit' });
const ctrl = spawn('python3', ['-m', 'controller', 'run'], { cwd: CTRL, env, stdio: ['ignore', 'pipe', 'pipe'] });
let ctrlOut = '';
ctrl.stdout.on('data', (d) => (ctrlOut += d));
ctrl.stderr.on('data', (d) => (ctrlOut += d));
await page.getByText('is paired').waitFor({ timeout: 15000 });
await page.getByText('It is online and ready').waitFor({ timeout: 15000 });
log('device paired & online');
await page.getByRole('button', { name: 'Done' }).click();

// core journey via dashboard composer
await page.goto(BASE + '/');
const input = page.getByRole('textbox', { name: 'Command' });
async function send(text, waitFor = 'Completed|Failed|Awaiting approval|Timed out') {
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(1500);
}
await send('Downloads folder kholo.');
await page.goto(BASE + '/history');
await page.getByText('Completed').first().waitFor({ timeout: 10000 });
log('Downloads folder kholo → Completed');
await page.goto(BASE + '/chat');
const chatInput = page.getByRole('textbox', { name: 'Command' });
for (const t of ['Chrome kholo', 'Meri invoice wali file search karo', 'Browser mein Forex news search karo', 'laptop ka status batao', 'aaj mausam kaisa hai', 'Desktop par latest Excel file dhoondo', 'Mujhe laptop ki screen dikhao']) {
  await chatInput.fill(t);
  await chatInput.press('Enter');
  await page.waitForTimeout(1600);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/04-chat-desktop.png`, fullPage: false });
// approve the screenshot
const approveBtn = page.getByRole('button', { name: 'Approve' }).first();
if (await approveBtn.isVisible()) {
  await page.screenshot({ path: `${SHOTS}/05-approval.png` });
  await approveBtn.click();
  await page.waitForTimeout(2500);
}
// youtube (network may be blocked here → honest fallback)
await chatInput.fill('YouTube par Gold analysis play karo');
await chatInput.press('Enter');
await page.waitForTimeout(9000);
await page.screenshot({ path: `${SHOTS}/06-chat-after.png` });

await page.goto(BASE + '/');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/07-dashboard-desktop.png` });
await page.screenshot({ path: `${SHOTS}/07b-dashboard-full.png`, fullPage: true });
for (const p of ['devices', 'files', 'history', 'whatsapp', 'browser', 'automations', 'voice', 'settings']) {
  await page.goto(`${BASE}/${p}`);
  await page.waitForTimeout(p === 'files' ? 2500 : 1000);
  await page.screenshot({ path: `${SHOTS}/08-${p}.png` });
}

// mobile
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
const mp = await m.newPage();
mp.on('pageerror', (e) => errors.push('mobile: ' + e));
await mp.goto(BASE + '/');
await mp.waitForTimeout(1800);
await mp.screenshot({ path: `${SHOTS}/10-mobile-dashboard.png` });
await mp.screenshot({ path: `${SHOTS}/10b-mobile-dashboard-full.png`, fullPage: true });
await mp.goto(BASE + '/chat');
await mp.waitForTimeout(1200);
await mp.screenshot({ path: `${SHOTS}/11-mobile-chat.png` });
await mp.getByRole('button', { name: 'More' }).click();
await mp.waitForTimeout(500);
await mp.screenshot({ path: `${SHOTS}/12-mobile-more.png` });
await mp.goto(BASE + '/devices');
await mp.waitForTimeout(1000);
await mp.screenshot({ path: `${SHOTS}/13-mobile-devices.png` });

// light theme check
await page.goto(BASE + '/settings');
await page.getByRole('button', { name: 'Light' }).click();
await page.goto(BASE + '/');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/14-light.png` });
await page.goto(BASE + '/settings');
await page.getByRole('button', { name: 'Midnight Navy' }).click();

// emergency stop
await page.goto(BASE + '/');
await page.getByTitle('Emergency stop: pause all devices and cancel running commands').click();
await page.waitForTimeout(1500);
log('controller paused:', /EMERGENCY STOP/.test(ctrlOut));
await page.goto(BASE + '/devices');
await page.getByRole('button', { name: 'Resume control' }).click();
await page.waitForTimeout(800);

const hist = await page.evaluate(async () => (await fetch('/api/commands?limit=50')).json());
console.log('[e2e] commands:', hist.map((c) => `${c.action}:${c.status}${c.error ? '(' + c.error.code + ')' : ''}`).join(' | '));
console.log('[e2e] page errors:', errors.length ? errors : 'none');
console.log('[e2e] controller log tail:\n' + ctrlOut.split('\n').slice(-25).join('\n'));
ctrl.kill('SIGINT');
await browser.close();
