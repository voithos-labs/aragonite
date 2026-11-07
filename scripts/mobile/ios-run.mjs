// Runs every iOS row, then the probes, in Mobile Safari on the iOS Simulator through Appium's
// XCUITest driver, each on a freshly loaded harness page, and writes `result.json` to the out dir.
// Exits 1 when any row fails. Usage: node ios-run.mjs <out dir>, with Appium on 127.0.0.1:4723.
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { probes, rows } from './ios-rows.mjs';

const out = process.argv[2];
const URL = 'http://127.0.0.1:1430/test/editor';
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const started = Date.now();
const timings = {};
const mark = (name) => (timings[name] = Date.now() - started);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// No client timeout: a cold Simulator takes minutes to hand over a session.
function call(method, route, body) {
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port: 4723,
				path: route,
				method,
				headers: { 'content-type': 'application/json' }
			},
			(res) => {
				let text = '';
				res.on('data', (chunk) => (text += chunk));
				res.on('end', () => {
					const reply = JSON.parse(text || '{}');
					if (res.statusCode >= 400)
						reject(new Error(`${method} ${route}: ${text.slice(0, 2000)}`));
					else resolve(reply.value);
				});
			}
		);
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}

function pickSimulator() {
	const { devices } = JSON.parse(
		execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' })
	);
	const runtimes = Object.keys(devices)
		.filter(
			(key) => /SimRuntime\.iOS-/.test(key) && devices[key].some((d) => /^iPhone/.test(d.name))
		)
		.map((key) => ({ key, version: key.split('iOS-')[1].split('-').map(Number) }))
		.sort((a, b) => b.version[0] - a.version[0] || (b.version[1] ?? 0) - (a.version[1] ?? 0));
	if (!runtimes.length) throw new Error('no iOS runtime with an iPhone simulator');
	const list = devices[runtimes[0].key].filter((d) => /^iPhone/.test(d.name));
	const device = list.find((d) => /^iPhone \d+$/.test(d.name)) ?? list[0];
	return { ...device, platformVersion: runtimes[0].version.join('.') };
}

const sim = pickSimulator();
// Booted before the session request, which Appium's server drops once it runs past its keep-alive.
execFileSync('xcrun', ['simctl', 'bootstatus', sim.udid, '-b'], { stdio: 'inherit' });
mark('simulator booted');
const session = await call('POST', '/session', {
	capabilities: {
		alwaysMatch: {
			platformName: 'iOS',
			browserName: 'Safari',
			'appium:automationName': 'XCUITest',
			'appium:udid': sim.udid,
			'appium:deviceName': sim.name,
			'appium:platformVersion': sim.platformVersion,
			'appium:connectHardwareKeyboard': false,
			'appium:forceSimulatorSoftwareKeyboardPresence': true,
			'appium:nativeWebTap': true,
			'appium:safariInitialUrl': URL,
			'appium:wdaLaunchTimeout': 600000,
			'appium:simulatorStartupTimeout': 600000,
			'appium:newCommandTimeout': 900,
			'appium:webviewConnectTimeout': 60000,
			// The workflow builds WebDriverAgent in its own step, so the session only launches it.
			'appium:usePrebuiltWDA': true,
			'appium:derivedDataPath': process.env.WDA_DERIVED_DATA,
			'appium:showXcodeLog': true
		}
	}
});
const s = (route) => `/session/${session.sessionId}${route}`;
mark('session');

const native = () => call('POST', s('/context'), { name: 'NATIVE_APP' });
// Safari's page context id can change on navigation, so each switch looks it up.
async function web() {
	const contexts = (await call('GET', s('/contexts'))).map((c) => c.id ?? c);
	const page = contexts.filter((c) => c !== 'NATIVE_APP').at(-1);
	if (!page) throw new Error(`no web context among ${JSON.stringify(contexts)}`);
	return call('POST', s('/context'), { name: page });
}
const run = (script, ...args) => call('POST', s('/execute/sync'), { script, args });
const find = async (using, value) => (await call('POST', s('/element'), { using, value }))[ELEMENT];
const tryFind = (using, value) => find(using, value).catch(() => null);
const click = (id) => call('POST', s(`/element/${id}/click`), {});
const source = () => run('return window.__test.getSource()');
const editable = async (index) =>
	(await tryFind('css selector', `[data-block-path="[${index}]"] [contenteditable="true"]`)) ??
	(await find('css selector', `[data-block-path="[${index}]"]`));
const screenshot = async (name) =>
	writeFileSync(
		path.join(out, `${name}.png`),
		Buffer.from(await call('GET', s('/screenshot')), 'base64')
	);

// A new page load, then the document: every row starts from a page no earlier row touched. A seed
// that didn't take is tried once more on a new load, then fails the row with that as its reason.
async function fresh(url, text) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		await web();
		await call('POST', s('/url'), { url });
		await dismissSafariTip();
		await web();
		for (let i = 0; i < 120 && !(await run('return !!window.__test').catch(() => false)); i++)
			await sleep(500);
		await run('window.__test.setSource(arguments[0]); return true', text).catch(() => {});
		for (let i = 0; i < 40; i++) {
			if ((await source().catch(() => null)) === text) return;
			await sleep(250);
		}
	}
	throw new Error('the seeded document never applied, after two page loads');
}

// Safari's first-run tip ("View Bookmarks, Share Menu, and Open Tabs") covers the page and swallows
// the next touch. It's closed by the button nearest its text's top-right corner, else by a tap on
// the status bar outside it, which only scrolls a page to its top; a tip that stays fails the row.
async function dismissSafariTip() {
	await native();
	for (let attempt = 1; attempt <= 3; attempt++) {
		const tip = await tryFind('-ios predicate string', TIP);
		if (!tip) return web();
		if (attempt === 1)
			writeFileSync(path.join(out, 'safari-tip.xml'), String(await call('GET', s('/source'))));
		const at = await call('GET', s(`/element/${tip}/rect`));
		const close = await nearestButton({ x: at.x + at.width, y: at.y }, 80);
		if (close) await click(close);
		else
			await call('POST', s('/execute/sync'), { script: 'mobile: tap', args: [{ x: 20, y: 12 }] });
		await sleep(800);
	}
	if (await tryFind('-ios predicate string', TIP))
		throw new Error("Safari's first-run tip stayed over the page after three tries to close it");
	await web();
}

const TIP = "label BEGINSWITH 'View Bookmarks'";

// The button whose centre is nearest `point`, within `reach` points.
async function nearestButton(point, reach) {
	const buttons = await call('POST', s('/elements'), {
		using: '-ios predicate string',
		value: "type == 'XCUIElementTypeButton'"
	});
	let nearest = null;
	for (const found of buttons) {
		const id = found[ELEMENT];
		const r = await call('GET', s(`/element/${id}/rect`));
		const d = Math.hypot(r.x + r.width / 2 - point.x, r.y + r.height / 2 - point.y);
		if (d <= reach && (!nearest || d < nearest.d)) nearest = { id, d };
	}
	return nearest?.id ?? null;
}

const ctx = {
	out,
	url: URL,
	call,
	s,
	native,
	web,
	run,
	find,
	tryFind,
	click,
	source,
	editable,
	screenshot,
	fresh,
	dismissSafariTip
};
const result = { platform: 'ios', simulator: sim, timings, rows: [], probes: [] };
for (const [name, runRow] of Object.entries(rows)) {
	const begun = Date.now();
	const row = await runRow(ctx).catch((error) => ({ reasons: [String(error?.stack ?? error)] }));
	result.rows.push({ ...row, name, pass: row.reasons.length === 0, ms: Date.now() - begun });
	mark(name);
}
for (const [name, runProbe] of Object.entries(probes)) {
	const outcome = await runProbe(ctx).catch((error) => ({ error: String(error?.stack ?? error) }));
	result.probes.push({ ...outcome, name });
	mark(name);
}
await call('DELETE', s('')).catch(() => {});

writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
const lines = result.rows.map(
	(row) =>
		`- ${row.pass ? 'PASS' : 'FAIL'} ${row.name}${row.pass ? '' : `: ${row.reasons.join('; ')}`}`
);
const summary = `### iOS rows\n\n${lines.join('\n')}\n\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(result.rows.every((row) => row.pass) ? 0 : 1);
