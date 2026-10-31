// Types one word into the editor harness through Gboard's on-screen keys on an Android emulator,
// then once more with `adb shell input text` as the control, recording the input of each. A third
// paragraph, with spellcheck switched on, shows whether Gboard composes where suggestions are allowed.
// Every tap and key is a touch on the device (`adb shell input tap`); the page connection over
// CDP only seeds the document, starts and stops the recording and reads the result back.
// Usage: node android-type.mjs <out dir>, with Chrome on the harness and port 9222 forwarded.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
const WORD = 'hello';
const SOURCE = 'alpha beta\n\ngamma delta\n\nepsilon zeta\n';
const started = Date.now();
const timings = {};
const mark = (name) => (timings[name] = Date.now() - started);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' });
const adbBuffer = (...args) => execFileSync('adb', args, { maxBuffer: 64 << 20 });
const tap = (x, y) => adb('shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y)));
const centre = (box) => ({ x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 });
const screenshot = (name) =>
	writeFileSync(path.join(out, `${name}.png`), adbBuffer('exec-out', 'screencap', '-p'));

// ── The page, over CDP ──────────────────────────

async function connect() {
	for (let i = 0; i < 90; i++) {
		try {
			const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
			const page = targets.find((t) => t.type === 'page' && t.url.includes('/test/editor'));
			if (page) return openSocket(page.webSocketDebuggerUrl);
		} catch {}
		await sleep(1000);
	}
	screenshot('no-page');
	throw new Error('Chrome never showed the harness page on port 9222');
}

function openSocket(url) {
	const ws = new WebSocket(url);
	let id = 0;
	const pending = new Map();
	ws.onmessage = (msg) => {
		const reply = JSON.parse(msg.data);
		pending.get(reply.id)?.(reply);
		pending.delete(reply.id);
	};
	const evaluate = (expression) =>
		new Promise((resolve, reject) => {
			const callId = ++id;
			pending.set(callId, (reply) => {
				const r = reply.result;
				if (reply.error || r?.exceptionDetails)
					reject(new Error(JSON.stringify(reply.error ?? r.exceptionDetails)));
				else resolve(r.result.value);
			});
			ws.send(
				JSON.stringify({
					id: callId,
					method: 'Runtime.evaluate',
					params: { expression, awaitPromise: true, returnByValue: true }
				})
			);
		});
	return new Promise((resolve, reject) => {
		ws.onopen = () => resolve({ evaluate, close: () => ws.close() });
		ws.onerror = () => reject(new Error(`CDP socket failed: ${url}`));
	});
}

// ── The screen, over uiautomator ──────────────────────────

// uiautomator can fail to dump a screen that never goes idle, leaving a stale file behind, so each
// try removes the file first. `--windows` dumps every window, the keyboard's included.
function dumpNodes(name, ...flags) {
	let xml = null;
	for (let i = 0; i < 4 && xml === null; i++) {
		adb('shell', 'rm', '-f', '/sdcard/ui.xml');
		try {
			adb('shell', 'uiautomator', 'dump', ...flags, '/sdcard/ui.xml');
			xml = adb('exec-out', 'cat', '/sdcard/ui.xml');
		} catch {}
	}
	if (xml === null) throw new Error(`uiautomator dump ${flags.join(' ')} failed four times`);
	if (name) writeFileSync(path.join(out, `${name}.xml`), xml);
	return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => {
		const attr = (key) => tag.match(new RegExp(` ${key}="([^"]*)"`))?.[1] ?? '';
		const [x1, y1, x2, y2] = attr('bounds').match(/\d+/g).map(Number);
		return {
			text: attr('text'),
			desc: attr('content-desc'),
			id: attr('resource-id'),
			cls: attr('class'),
			pkg: attr('package'),
			box: { x1, y1, x2, y2 }
		};
	});
}

// Chrome exposes each paragraph to accessibility as an EditText holding its text, and builds that
// tree only once something asks, so the lookup polls. It also waits out two things that move or
// cover the page: the notifications prompt, and the "Back online" bar above the toolbar.
async function paragraphBox(text, name) {
	for (let i = 0; i < 30; i++) {
		const nodes = dumpNodes(`${name}-before-tap`);
		const dismiss = nodes.find((n) => n.text === 'No thanks');
		if (dismiss) tap(centre(dismiss.box).x, centre(dismiss.box).y);
		const banner = nodes.some((n) => n.id === 'com.android.chrome:id/status_text');
		const node = nodes.find(
			(n) =>
				n.pkg === 'com.android.chrome' && n.cls === 'android.widget.EditText' && n.text === text
		);
		if (node && !dismiss && !banner) return node.box;
		await sleep(500);
	}
	throw new Error(`no settled EditText node reading "${text}" in the screen dump`);
}

function imeShown() {
	return /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'));
}

// The last number (or WxH pair) `wm size` and `wm density` print, which is the override if one is set.
const lastReading = (text) => [...text.matchAll(/(\d+)(?:x(\d+))?\s*$/gm)].at(-1);

// Gboard's keys by their accessibility labels, from a dump of every window. The fallback is its
// QWERTY grid, measured off a Pixel 6 screenshot at density 420 and anchored to the screen bottom.
const ROWS_FROM_BOTTOM = [684, 532, 376, 220];
function gboardKeys() {
	const [, width, height] = lastReading(adb('shell', 'wm', 'size')).map(Number);
	const scale = Number(lastReading(adb('shell', 'wm', 'density'))[1]) / 420;
	const keyWidth = width / 10;
	const indent = [0, 0.5, 1.5];
	const keys = new Map();
	['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].forEach((row, r) =>
		[...row].forEach((ch, i) =>
			keys.set(ch, {
				x: (indent[r] + i + 0.5) * keyWidth,
				y: height - ROWS_FROM_BOTTOM[r] * scale,
				from: 'grid'
			})
		)
	);
	keys.set(' ', { x: 0.55 * width, y: height - ROWS_FROM_BOTTOM[3] * scale, from: 'grid' });
	for (const n of dumpNodes('keyboard-all-windows', '--windows')) {
		if (!n.pkg.includes('inputmethod')) continue;
		const label = n.desc === 'Space' ? ' ' : n.desc;
		if (/^[a-z ]$/.test(label)) keys.set(label, { ...centre(n.box), from: 'accessibility' });
	}
	return keys;
}

// ── One trial ──────────────────────────

// Near the right edge, past the end of the short line, so the caret lands at the line's end. A
// tap that lands in another block (the page moved after the dump) is retried.
async function caretTap(page, blockIndex, name, result) {
	const source = await page.evaluate('window.__test.getSource()');
	const text = source.split('\n\n')[blockIndex].trimEnd();
	let selection = null;
	for (result.tapAttempts = 1; result.tapAttempts <= 3; result.tapAttempts++) {
		const box = await paragraphBox(text, name);
		tap(box.x2 - 40, centre(box).y);
		for (let i = 0; i < 40 && !imeShown(); i++) await sleep(250);
		await sleep(500);
		selection = await page.evaluate('window.__test.getSelection()');
		if (imeShown() && selection?.focus.path[0] === blockIndex) return selection;
	}
	throw new Error(
		`three taps meant for block ${blockIndex} left keyboard ${imeShown()}, caret ${JSON.stringify(selection)}`
	);
}

async function settle(page, expected) {
	let source = '';
	for (let i = 0; i < 40; i++) {
		source = await page.evaluate('window.__test.getSource()');
		if (source === expected) break;
		await sleep(250);
	}
	return source;
}

async function trial(page, blockIndex, name, type) {
	const result = { method: name };
	try {
		await page.evaluate('window.__test.startInputRecording({ includeText: true })');
		const selection = await caretTap(page, blockIndex, name, result);
		result.caret = selection;
		const before = await page.evaluate('window.__test.getSource()');
		const at = before.indexOf(before.split('\n\n')[blockIndex]) + selection.focus.offset;
		result.expected = `${before.slice(0, at)} ${WORD} ${before.slice(at)}`;
		result.typing = await type();
		result.actual = await settle(page, result.expected);
	} catch (error) {
		result.error = String(error?.stack ?? error);
	}
	screenshot(name);
	result.recording = await page.evaluate('window.__test.stopInputRecording()').catch(() => null);
	writeFileSync(
		path.join(out, `${name}.recording.json`),
		JSON.stringify(result.recording, null, 2)
	);
	mark(name);
	return result;
}

async function typeOnGboard(name) {
	screenshot(`${name}-keyboard`);
	const keys = gboardKeys();
	const used = [...` ${WORD} `].map((ch) => keys.get(ch));
	for (const key of used) {
		tap(key.x, key.y);
		await sleep(400);
	}
	return { keys: [...new Set(used.map((k) => k.from))].join('+') };
}

// ── Run ──────────────────────────

const page = await connect();
for (let i = 0; i < 120 && !(await page.evaluate('!!window.__test')); i++) await sleep(500);
await page.evaluate(`window.__test.setSource(${JSON.stringify(SOURCE)})`);
mark('page ready');

const real = await trial(page, 0, 'real', () => typeOnGboard('real'));
const control = await trial(page, 1, 'control', async () => {
	adb('shell', 'input', 'text', `%s${WORD}%s`);
	return { channel: 'adb shell input text' };
});
// Flipped before the tap, since Chrome hands the keyboard a field's flags when it gains focus.
const SPELLCHECK = `document.querySelector('[data-block-path="[2]"] [contenteditable="true"]')?.spellcheck ?? null`;
await page.evaluate(`(() => {
	const el = document.querySelector('[data-block-path="[2]"] [contenteditable="true"]');
	if (el) el.spellcheck = true;
})()`);
const spellcheckOn = await trial(page, 2, 'spellcheck-on', async () => ({
	spellcheckAtTap: await page.evaluate(SPELLCHECK),
	...(await typeOnGboard('spellcheck-on'))
}));
page.close();

writeFileSync(
	path.join(out, 'result.json'),
	JSON.stringify(
		{
			platform: 'android',
			timings,
			trials: { real, control, 'spellcheck-on': spellcheckOn }
		},
		null,
		2
	)
);
