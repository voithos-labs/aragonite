// Types one word into the editor harness in Mobile Safari on the iOS Simulator by tapping the
// on-screen keyboard's keys through Appium's XCUITest driver, then once more with WebDriver's
// sendKeys on the element (a JavaScript route) as the control, recording the input of each.
// The tap into the paragraph is a native tap (`nativeWebTap`); page scripts only seed, record
// and read back. Usage: node ios-type.mjs <out dir>, with Appium on 127.0.0.1:4723.
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
const URL = 'http://127.0.0.1:1430/test/editor';
const WORD = 'hello';
const SOURCE = 'alpha beta\n\ngamma delta\n';
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const started = Date.now();
const timings = {};
const mark = (name) => (timings[name] = Date.now() - started);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Appium over plain HTTP ──────────────────────────

// No client timeout: the first session builds WebDriverAgent, which takes minutes.
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
console.log(`simulator: ${sim.name}, iOS ${sim.platformVersion}, ${sim.udid}`);
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
const sid = session.sessionId;
const s = (route) => `/session/${sid}${route}`;
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
const screenshot = async (name) =>
	writeFileSync(
		path.join(out, `${name}.png`),
		Buffer.from(await call('GET', s('/screenshot')), 'base64')
	);
const source = () => run('return window.__test.getSource()');

// ── One trial ──────────────────────────

async function keyboardShown() {
	await native();
	for (let i = 0; i < 40; i++) {
		if (await tryFind('-ios class chain', '**/XCUIElementTypeKeyboard')) break;
		await sleep(250);
	}
	const shown = !!(await tryFind('-ios class chain', '**/XCUIElementTypeKeyboard'));
	await web();
	return shown;
}

async function settle(expected) {
	let text = '';
	for (let i = 0; i < 40; i++) {
		text = await source();
		if (text === expected) break;
		await sleep(250);
	}
	return text;
}

async function trial(name, blockIndex, type) {
	const result = { method: name };
	try {
		await run('window.__test.startInputRecording({ includeText: true }); return true');
		result.typing = await type(blockIndex, result);
		await web();
		result.actual = await settle(result.expected);
	} catch (error) {
		result.error = String(error?.stack ?? error);
	}
	await screenshot(name).catch(() => {});
	await web().catch(() => {});
	result.recording = await run('return window.__test.stopInputRecording()').catch(() => null);
	writeFileSync(
		path.join(out, `${name}.recording.json`),
		JSON.stringify(result.recording, null, 2)
	);
	mark(name);
	return result;
}

async function expectAtCaret(blockIndex, result) {
	const selection = await run('return window.__test.getSelection()');
	const before = await source();
	const at = before.indexOf(before.split('\n\n')[blockIndex]) + selection.focus.offset;
	result.caret = selection;
	result.expected = `${before.slice(0, at)} ${WORD} ${before.slice(at)}`;
}

// The paragraph's editable, found the way the control finds it.
const editable = async (blockIndex) =>
	(await tryFind('css selector', `[data-block-path="[${blockIndex}]"] [contenteditable="true"]`)) ??
	(await find('css selector', `[data-block-path="[${blockIndex}]"]`));

// The editable's centre sits past the end of its short line, so the tap leaves the caret at the
// end. A tap that brings up no keyboard is tried up to three times, and the count is kept.
async function tapKeys(blockIndex, result) {
	result.tapAttempts = 0;
	while (result.tapAttempts < 3) {
		result.tapAttempts++;
		await click(await editable(blockIndex));
		if (await keyboardShown()) break;
	}
	if (!(await keyboardShown())) throw new Error('the soft keyboard never showed after three taps');
	await expectAtCaret(blockIndex, result);
	if (result.caret?.focus.path[0] !== blockIndex)
		throw new Error(
			`the tap meant for block ${blockIndex} landed at ${JSON.stringify(result.caret)}`
		);
	await native();
	const keyFor = (ch) =>
		tryFind(
			'-ios predicate string',
			`type == 'XCUIElementTypeKey' AND name == '${ch === ' ' ? 'space' : ch}'`
		);
	if (!(await keyFor('h'))) {
		writeFileSync(path.join(out, 'native-tree.xml'), await call('GET', s('/source')));
		await run('mobile: keys', { keys: [...` ${WORD} `] });
		return { keys: 'mobile: keys (no key elements found)' };
	}
	for (const ch of ` ${WORD} `) {
		await click(await keyFor(ch));
		await sleep(300);
	}
	return { keys: 'XCUIElementTypeKey taps' };
}

async function sendKeys(blockIndex, result) {
	const id = await editable(blockIndex);
	result.before = await source();
	await call('POST', s(`/element/${id}/value`), { text: ` ${WORD} ` });
	await sleep(1000);
	return { channel: 'WebDriver element sendKeys in the web context' };
}

// ── Run ──────────────────────────

await web();
await call('POST', s('/url'), { url: URL });
for (let i = 0; i < 120 && !(await run('return !!window.__test')); i++) await sleep(500);
await run('window.__test.setSource(arguments[0]); return true', SOURCE);
await settle(SOURCE);
mark('page ready');

const real = await trial('real', 0, tapKeys);
const control = await trial('control', 1, sendKeys);
await call('DELETE', s('')).catch(() => {});

writeFileSync(
	path.join(out, 'result.json'),
	JSON.stringify({ platform: 'ios', simulator: sim, timings, trials: { real, control } }, null, 2)
);
