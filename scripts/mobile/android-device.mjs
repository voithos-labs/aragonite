// The Android emulator as the rows see it: adb taps and swipes, screen dumps, Gboard's keys, and
// the harness page over CDP. Every tap and key is a touch on the device; the page connection only
// seeds the document, records input and reads results back.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export const HARNESS_URL = 'http://localhost:1430/test/editor';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const centre = (box) => ({ x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 });

export function createDevice(out) {
	const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' });
	const adbBuffer = (...args) => execFileSync('adb', args, { maxBuffer: 64 << 20 });
	const int = (n) => String(Math.round(n));
	const tap = (x, y) => adb('shell', 'input', 'tap', int(x), int(y));
	const swipe = (x1, y1, x2, y2, ms) =>
		adb('shell', 'input', 'swipe', int(x1), int(y1), int(x2), int(y2), String(ms));
	const screenshot = (name) =>
		writeFileSync(path.join(out, `${name}.png`), adbBuffer('exec-out', 'screencap', '-p'));

	// uiautomator can fail to dump a screen that never goes idle, leaving a stale file behind, so
	// each try removes the file first. `--windows` dumps every window, the keyboard's included.
	function dumpNodes(name, ...flags) {
		let xml = null;
		for (let i = 0; i < 4 && xml === null; i++) {
			adb('shell', 'rm', '-f', '/sdcard/ui.xml');
			try {
				adb('shell', 'uiautomator', 'dump', ...flags, '/sdcard/ui.xml');
				xml = adb('exec-out', 'cat', '/sdcard/ui.xml');
			} catch {
				// The next pass retries.
			}
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

	// Chrome's first-run and promo screens, and a system app's "isn't responding" dialog (a slow
	// emulator's), tapped through wherever they show.
	const DISMISS = ['No thanks', 'Accept & continue', 'Use without an account', 'Got it', 'Wait'];

	// Chrome exposes each paragraph to accessibility as an EditText holding its text, and builds
	// that tree only once something asks, so the lookup polls. It waits out what moves or covers
	// the page: a prompt, and for a few seconds the network bar above the toolbar.
	async function paragraphBox(text, name) {
		for (let i = 0; i < 30; i++) {
			const nodes = dumpNodes(name);
			const dismiss = nodes.find((n) => DISMISS.includes(n.text));
			if (dismiss) tap(centre(dismiss.box).x, centre(dismiss.box).y);
			const banner = nodes.some((n) => n.id === 'com.android.chrome:id/status_text');
			const node = nodes.find(
				(n) =>
					n.pkg === 'com.android.chrome' &&
					n.cls === 'android.widget.EditText' &&
					n.text.trim() === text
			);
			// "Back online" leaves within seconds; "No internet connection" stays, and a tap that lands
			// in the wrong block is retried anyway.
			if (node && !dismiss && (!banner || i >= 8)) return node.box;
			await sleep(500);
		}
		throw new Error(`no settled EditText node reading "${text}" in the screen dump`);
	}

	const imeShown = () => /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'));

	// Back closes the keyboard and keeps focus; pressed only while it shows, since otherwise Back
	// would leave the page.
	async function hideKeyboard() {
		if (!imeShown()) return;
		adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
		for (let i = 0; i < 20 && imeShown(); i++) await sleep(250);
		await sleep(500);
	}

	// Gboard's keys by their accessibility labels, from a dump of every window; an empty map when the
	// keyboard isn't on screen (Gboard can sit collapsed while its input connection is up).
	function gboardKeys(name) {
		const keys = new Map();
		for (const n of dumpNodes(name, '--windows')) {
			if (!n.pkg.includes('inputmethod')) continue;
			const label = n.desc === 'Space' ? ' ' : n.desc;
			if (/^[a-z ]$/.test(label)) keys.set(label, centre(n.box));
		}
		return keys;
	}

	// Chrome can drop the launch intent while it starts up and show its New Tab page, so the
	// intent is re-sent, and as a last resort the open tab is sent to the harness over CDP.
	async function connect() {
		const intent = ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', HARNESS_URL];
		for (let i = 0; i < 90; i++) {
			const targets = await fetch('http://127.0.0.1:9222/json/list')
				.then((res) => res.json())
				.catch(() => []);
			const page = targets.find((t) => t.type === 'page' && t.url.includes('/test/editor'));
			if (page) return openPage(page.webSocketDebuggerUrl);
			if (i % 15 === 14 && i < 45) {
				try {
					adb(...intent, 'com.android.chrome');
				} catch {
					// Chrome may still be starting; a later pass sends it again.
				}
			}
			const other = targets.find((t) => t.type === 'page');
			if (i >= 50 && i % 10 === 0 && other) {
				const tab = await openPage(other.webSocketDebuggerUrl).catch(() => null);
				await tab?.evaluate(`location.href = ${JSON.stringify(HARNESS_URL)}`).catch(() => {});
				tab?.close();
			}
			await sleep(1000);
		}
		screenshot('no-page');
		throw new Error('Chrome never showed the harness page on port 9222');
	}

	return {
		adb,
		tap,
		swipe,
		screenshot,
		dumpNodes,
		paragraphBox,
		imeShown,
		hideKeyboard,
		gboardKeys,
		connect
	};
}

function openPage(url) {
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
