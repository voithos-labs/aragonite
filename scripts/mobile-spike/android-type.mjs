// Types one word into the editor harness through Gboard's on-screen keys on an Android emulator,
// then once more with `adb shell input text` as the control, recording the input of each.
// Every tap and key is a touch on the device (`adb shell input tap`); the page connection over
// CDP only seeds the document, starts and stops the recording and reads the result back.
// Usage: node android-type.mjs <out dir>, with Chrome on the harness and port 9222 forwarded.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
const WORD = 'hello';
const SOURCE = 'alpha beta\n\ngamma delta\n';
const started = Date.now();
const timings = {};
const mark = (name) => (timings[name] = Date.now() - started);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' });
const adbBuffer = (...args) => execFileSync('adb', args, { maxBuffer: 64 << 20 });
const tap = (x, y) => adb('shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y)));
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
// try removes the file first.
function dumpXml() {
	for (let i = 0; i < 4; i++) {
		adb('shell', 'rm', '-f', '/sdcard/ui.xml');
		try {
			adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
			return adb('exec-out', 'cat', '/sdcard/ui.xml');
		} catch {}
	}
	throw new Error('uiautomator dump failed four times');
}

function dumpNodes(name) {
	const xml = dumpXml();
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

// Chrome exposes the page's viewport to accessibility as one android.webkit.WebView node; without
// it, the page starts below the toolbar inside the compositor view.
function viewportBox(nodes) {
	const web = nodes.find(
		(n) => n.pkg === 'com.android.chrome' && n.cls === 'android.webkit.WebView'
	);
	if (web) return { ...web.box, from: 'WebView node' };
	const holder = nodes.find((n) => n.id === 'com.android.chrome:id/compositor_view_holder');
	const toolbar = nodes.find((n) => n.id === 'com.android.chrome:id/control_container');
	if (!holder) throw new Error('no web content node in the screen dump');
	return {
		...holder.box,
		y1: Math.max(holder.box.y1, toolbar?.box.y2 ?? 0),
		from: 'compositor view'
	};
}

function imeShown() {
	return /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'));
}

// Gboard's keys by their accessibility labels; when it exposes none, positions from the standard
// QWERTY grid inside the keyboard window, which the run's screenshot then has to confirm.
function keyMap(nodes, imePackage) {
	const keys = new Map();
	const ime = nodes.filter((n) => n.pkg === imePackage);
	for (const n of ime) {
		const label = (n.desc || n.text).toLowerCase();
		const center = { x: (n.box.x1 + n.box.x2) / 2, y: (n.box.y1 + n.box.y2) / 2 };
		if (/^[a-z]$/.test(label)) keys.set(label, center);
		else if (label === 'space' || n.id.endsWith('space')) keys.set(' ', center);
	}
	if (keys.has('h') && keys.has(' '))
		return { source: 'accessibility', keys, imeNodes: ime.length };
	if (ime.length === 0) throw new Error(`no ${imePackage} nodes in the screen dump`);
	const x1 = Math.min(...ime.map((n) => n.box.x1));
	const x2 = Math.max(...ime.map((n) => n.box.x2));
	const y1 = Math.min(...ime.map((n) => n.box.y1));
	const y2 = Math.max(...ime.map((n) => n.box.y2));
	const rowHeight = (y2 - y1) / 5;
	const keyWidth = (x2 - x1) / 10;
	const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
	const indent = [0, 0.5, 1.5];
	rows.forEach((row, r) =>
		[...row].forEach((ch, i) =>
			keys.set(ch, { x: x1 + (indent[r] + i + 0.5) * keyWidth, y: y1 + (r + 1.5) * rowHeight })
		)
	);
	keys.set(' ', { x: (x1 + x2) / 2, y: y1 + 4.5 * rowHeight });
	return { source: 'grid', keys, imeNodes: ime.length };
}

// ── One trial ──────────────────────────

async function caretTap(page, blockPath, name) {
	const target = await page.evaluate(`(() => {
		const text = window.__test.getSource().split('\\n\\n')[${blockPath[0]}].trimEnd();
		const r = window.__test.rects.rangeRects([${blockPath[0]}], text.length - 1, text.length)[0];
		return { x: r.right + 4, y: (r.top + r.bottom) / 2, width: window.innerWidth };
	})()`);
	const nodes = dumpNodes(`${name}-before-tap`);
	const view = viewportBox(nodes);
	const scale = (view.x2 - view.x1) / target.width;
	tap(view.x1 + target.x * scale, view.y1 + target.y * scale);
	for (let i = 0; i < 40 && !imeShown(); i++) await sleep(250);
	if (!imeShown()) throw new Error('the soft keyboard never showed after the tap');
	await sleep(500);
	return { selection: await page.evaluate('window.__test.getSelection()'), viewport: view.from };
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

async function trial(page, blockPath, name, type) {
	const result = { method: name };
	try {
		await page.evaluate('window.__test.startInputRecording({ includeText: true })');
		const { selection, viewport } = await caretTap(page, blockPath, name);
		result.caret = selection;
		result.viewport = viewport;
		const before = await page.evaluate('window.__test.getSource()');
		const blockStart = before.indexOf(before.split('\n\n')[blockPath[0]]);
		const at = blockStart + selection.focus.offset;
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

// ── Run ──────────────────────────

const imePackage = adb('shell', 'settings', 'get', 'secure', 'default_input_method')
	.trim()
	.split('/')[0];
const page = await connect();
for (let i = 0; i < 120 && !(await page.evaluate('!!window.__test')); i++) await sleep(500);
await page.evaluate(`window.__test.setSource(${JSON.stringify(SOURCE)})`);
mark('page ready');

const real = await trial(page, [0], 'real', async () => {
	const map = keyMap(dumpNodes('keyboard'), imePackage);
	for (const ch of ` ${WORD} `) {
		const key = map.keys.get(ch);
		tap(key.x, key.y);
		await sleep(400);
	}
	return { keys: map.source, imeNodes: map.imeNodes, imePackage };
});
const control = await trial(page, [1], 'control', async () => {
	adb('shell', 'input', 'text', `%s${WORD}%s`);
	return { channel: 'adb shell input text' };
});
page.close();

writeFileSync(
	path.join(out, 'result.json'),
	JSON.stringify({ platform: 'android', timings, trials: { real, control } }, null, 2)
);
