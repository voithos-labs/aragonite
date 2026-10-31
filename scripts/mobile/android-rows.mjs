// The Android emulator rows, keyed by the scenario each one runs in
// `src/lib/e2e/requirements/mobile/android.md`; the probes are reported and judge nothing. A row
// gets a freshly loaded page and returns the reasons it failed, none when it passed.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { centre, sleep } from './android-device.mjs';
import { distinguishable, shape, softKeyboardReasons } from './judge.mjs';

const WORD = 'hello';
const SHORT = 'alpha beta\n\ngamma delta\n\nepsilon zeta\n';
// Filler below the trial paragraphs gives a swipe something to scroll.
const LONG = `${SHORT}\n${Array.from({ length: 24 }, (_, i) => `filler line ${i + 1}`).join('\n\n')}\n`;
const RANGE = { anchor: { path: [0], offset: 2 }, focus: { path: [1], offset: 5 } };
// The range's formatting toolbar sits over the first paragraphs and takes a tap as a command, so a
// gesture meant for the text lands on `filler line 4`, well below it.
const BELOW_RANGE = 6;

// ── Rows ──────────────────────────

export const rows = {
	'types a word through Gboard': async (ctx) => {
		await ctx.fresh(SHORT);
		const real = await typeWord(ctx, 0, 'gboard', () => typeOnGboard(ctx, 'gboard'));
		const control = await typeWord(ctx, 1, 'input-text', async () => {
			ctx.device.adb('shell', 'input', 'text', `%s${WORD}%s`);
		});
		const reasons = [...landedReasons('Gboard', real), ...softKeyboardReasons(real.recording)];
		if (softKeyboardReasons(control.recording).length === 0)
			reasons.push('the `adb shell input text` control passed as a soft keyboard');
		if (!distinguishable(real.recording, control.recording))
			reasons.push('the Gboard and control recordings cannot be told apart');
		return { reasons, evidence: { real: summary(real), control: summary(control) } };
	},

	'a swipe after a tap keeps the caret': async (ctx) => {
		await ctx.fresh(LONG);
		const { selection: before } = await tapCaret(ctx, 0, 'swipe-caret');
		const swiped = await swipeOver(ctx, 1, 'swipe-caret');
		const reasons = [...swiped.reasons];
		if (!same(swiped.after, before))
			reasons.push(`the swipe moved the selection from ${json(before)} to ${json(swiped.after)}`);
		return { reasons, evidence: { before, ...swiped } };
	},

	'a swipe keeps a range across blocks': async (ctx) => {
		await ctx.fresh(LONG);
		await tapCaret(ctx, 0, 'swipe-range');
		await ctx.device.hideKeyboard();
		const before = await setRange(ctx);
		const swiped = await swipeOver(ctx, BELOW_RANGE, 'swipe-range');
		const reasons = [...swiped.reasons];
		if (!same(swiped.after, before))
			reasons.push(`the swipe changed the range from ${json(before)} to ${json(swiped.after)}`);
		return { reasons, evidence: { before, ...swiped } };
	},

	'a tap clears a range across blocks': async (ctx) => {
		await ctx.fresh(LONG);
		await tapCaret(ctx, 0, 'tap-range');
		await ctx.device.hideKeyboard();
		const before = await setRange(ctx);
		const box = await ctx.device.paragraphBox(
			lineText(await source(ctx), BELOW_RANGE),
			'tap-range-target'
		);
		const log = await logPointers(ctx, async () => ctx.device.tap(box.x2 - 40, centre(box).y));
		const after = await ctx.page.evaluate('window.__test.getSelection()');
		const reasons = [];
		if (!collapsedIn(after, BELOW_RANGE))
			reasons.push(`the tap left ${json(after)} instead of a caret in block ${BELOW_RANGE}`);
		return { reasons, evidence: { before, after, pointerLog: log } };
	}
};

// ── Probes ──────────────────────────

export const probes = {
	// Whether Gboard composes on a paragraph whose spellcheck is on, flipped before the tap since
	// Chrome hands the keyboard a field's flags when it gains focus.
	'gboard with spellcheck on': async (ctx) => {
		await ctx.fresh(SHORT);
		await ctx.page.evaluate(
			`document.querySelector('[data-block-path="[2]"] [contenteditable="true"]').spellcheck = true`
		);
		const typed = await typeWord(ctx, 2, 'spellcheck-on', () => typeOnGboard(ctx, 'spellcheck-on'));
		return summary(typed);
	},

	// Whether a tap-tap reaches the editor's own word rule (a mousedown whose detail is 2).
	'double tap on a word': async (ctx) => {
		await ctx.fresh(SHORT);
		const box = await ctx.device.paragraphBox(lineText(await source(ctx), 1), 'double-tap');
		const x = box.x1 + 60;
		const y = centre(box).y;
		const log = await logPointers(ctx, async () => {
			ctx.device.adb(
				'shell',
				`input tap ${Math.round(x)} ${Math.round(y)}; input tap ${Math.round(x)} ${Math.round(y)}`
			);
		});
		ctx.device.screenshot('double-tap');
		return { after: await ctx.page.evaluate(SELECTION), pointerLog: log };
	},

	'long press dragged across blocks': async (ctx) => {
		await ctx.fresh(SHORT);
		const text = await source(ctx);
		const from = await ctx.device.paragraphBox(lineText(text, 0), 'long-press-from');
		const to = await ctx.device.paragraphBox(lineText(text, 1), 'long-press-to');
		const args = [from.x1 + 60, centre(from).y, to.x1 + 200, centre(to).y].map(Math.round);
		const log = await logPointers(ctx, async () => {
			try {
				ctx.device.adb('shell', 'input', 'draganddrop', ...args.map(String), '2000');
			} catch {
				ctx.device.swipe(...args, 2000);
			}
		});
		ctx.device.screenshot('long-press-drag');
		return {
			gesture: `from ${args.slice(0, 2)} to ${args.slice(2)} over 2000 ms`,
			after: await ctx.page.evaluate(SELECTION),
			pointerLog: log
		};
	}
};

// ── Steps ──────────────────────────

const SELECTION = `({ editor: window.__test.getSelection(), dom: String(document.getSelection()) })`;
const json = (value) => JSON.stringify(value);
// Selections compare by their points alone; the bridge may hand back more fields than it took.
const point = (p) => p && [p.path, p.offset];
const same = (a, b) =>
	json(a && [point(a.anchor), point(a.focus)]) === json(b && [point(b.anchor), point(b.focus)]);
const source = (ctx) => ctx.page.evaluate('window.__test.getSource()');
const lineText = (text, index) => text.split('\n\n')[index].trimEnd();
const collapsedIn = (sel, index) =>
	sel?.anchor.path[0] === index && json(point(sel.anchor)) === json(point(sel.focus));

// Near the right edge, past the end of the short line, so the caret lands at the line's end. A tap
// that lands elsewhere (the page moved after the dump) is retried.
async function tapCaret(ctx, index, name) {
	const text = lineText(await source(ctx), index);
	let selection = null;
	for (let attempt = 1; attempt <= 3; attempt++) {
		const box = await ctx.device.paragraphBox(text, `${name}-tap`);
		ctx.device.tap(box.x2 - 40, centre(box).y);
		for (let i = 0; i < 40 && !ctx.device.imeShown(); i++) await sleep(250);
		await sleep(500);
		selection = await ctx.page.evaluate('window.__test.getSelection()');
		if (ctx.device.imeShown() && collapsedIn(selection, index)) return { selection, attempt };
	}
	throw new Error(
		`three taps on block ${index} left keyboard ${ctx.device.imeShown()}, ${json(selection)}`
	);
}

// A plain upward swipe that starts on block `index`'s text: a scroll, which the browser takes over
// with a pointercancel. A swipe that never became a scroll proves nothing, so that is a failure.
async function swipeOver(ctx, index, name) {
	const box = await ctx.device.paragraphBox(lineText(await source(ctx), index), `${name}-swipe`);
	const x = centre(box).x;
	const pointerLog = await logPointers(ctx, async () =>
		ctx.device.swipe(x, box.y1 + 20, x, box.y1 - 500, 300)
	);
	ctx.device.screenshot(`${name}-after-swipe`);
	const after = await ctx.page.evaluate('window.__test.getSelection()');
	const reasons = pointerLog.counts.pointercancel ? [] : ['the swipe never became a scroll'];
	return { after, pointerLog, reasons };
}

// The range is set through the bridge: what the row tests is what a touch does to a range.
async function setRange(ctx) {
	await ctx.page.evaluate(`window.__test.setSelection(${json(RANGE)})`);
	await sleep(500);
	const range = await ctx.page.evaluate('window.__test.getSelection()');
	if (!same(range, RANGE)) throw new Error(`the bridge set ${json(range)}, not ${json(RANGE)}`);
	return range;
}

// The input recorder keeps no pointermove or pointercancel, so the rows log those on the page,
// with whether a handler prevented each one, read after its dispatch.
async function logPointers(ctx, gesture) {
	await ctx.page.evaluate(`(() => {
		const log = (window.__pointerLog = []);
		const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'click', 'selectionchange'];
		for (const type of types)
			document.addEventListener(type, (e) => {
				if (window.__pointerLog !== log) return;
				const row = { type, t: Math.round(e.timeStamp), pointerType: e.pointerType, detail: e.detail, cancelable: e.cancelable };
				log.push(row);
				setTimeout(() => (row.prevented = e.defaultPrevented));
			}, true);
	})()`);
	await gesture();
	await sleep(1500);
	return ctx.page.evaluate(`(() => {
		const counts = {};
		for (const row of window.__pointerLog) counts[row.type] = (counts[row.type] ?? 0) + 1;
		return { counts, rows: window.__pointerLog.slice(0, 60) };
	})()`);
}

async function typeOnGboard(ctx, name) {
	ctx.device.screenshot(`${name}-keyboard`);
	const keys = ctx.device.gboardKeys(`${name}-windows`);
	const used = [...` ${WORD} `].map((ch) => keys.get(ch));
	for (const key of used) {
		ctx.device.tap(key.x, key.y);
		await sleep(400);
	}
	return { keys: [...new Set(used.map((k) => k.from))].join('+') };
}

// Taps block `index`, records the typing, and expects the word (between spaces) at the caret.
async function typeWord(ctx, index, name, type) {
	const result = { name };
	try {
		await ctx.page.evaluate('window.__test.startInputRecording({ includeText: true })');
		const { selection, attempt } = await tapCaret(ctx, index, name);
		result.caret = selection;
		result.tapAttempts = attempt;
		const before = await source(ctx);
		const at = before.indexOf(lineText(before, index)) + selection.focus.offset;
		result.expected = `${before.slice(0, at)} ${WORD} ${before.slice(at)}`;
		result.typing = await type();
		for (let i = 0; i < 40 && (await source(ctx)) !== result.expected; i++) await sleep(250);
		result.actual = await source(ctx);
	} catch (error) {
		result.error = String(error?.stack ?? error);
	}
	ctx.device.screenshot(name);
	result.recording = await ctx.page
		.evaluate('window.__test.stopInputRecording()')
		.catch(() => null);
	writeFileSync(path.join(ctx.out, `${name}.recording.json`), json(result.recording));
	return result;
}

function landedReasons(label, typed) {
	if (typed.error) return [`${label}: ${typed.error.split('\n')[0]}`];
	return typed.actual === typed.expected
		? []
		: [`${label}: expected ${json(typed.expected)}, got ${json(typed.actual)}`];
}

function summary(typed) {
	const { recording, ...rest } = typed;
	return { ...rest, shape: shape(recording) };
}
