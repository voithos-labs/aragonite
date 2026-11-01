// The iOS Simulator rows, keyed by the scenario each one runs in
// `src/lib/e2e/requirements/mobile/ios.md`; the probes are reported and judge nothing. Taps are
// native (`nativeWebTap`), keys are taps on the on-screen keyboard's `XCUIElementTypeKey`s.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { distinguishable, shape } from './judge.mjs';

const WORD = 'hello';
const SHORT = 'alpha beta\n\ngamma delta\n\nepsilon zeta\n';
const LONG = `${SHORT}\n${Array.from({ length: 24 }, (_, i) => `filler line ${i + 1}`).join('\n\n')}\n`;
const RANGE = { anchor: { path: [0], offset: 2 }, focus: { path: [1], offset: 5 } };
// The first paragraph below the range: a finger's toolbar sits above the range, and the
// Simulator's screen ends a few paragraphs further down.
const BELOW_RANGE = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Rows ──────────────────────────

export const rows = {
	'types a word through the on-screen keyboard': async (ctx) => {
		await ctx.fresh(ctx.url, SHORT);
		const real = await record(ctx, 'keyboard', (typed) => tapKeys(ctx, 0, typed));
		const control = await record(ctx, 'send-keys', (typed) => sendKeys(ctx, 1, typed));
		const reasons = [];
		if (real.error) reasons.push(real.error.split('\n')[0]);
		else if (real.actual !== real.expected)
			reasons.push(`expected ${JSON.stringify(real.expected)}, got ${JSON.stringify(real.actual)}`);
		if (shape(real.recording).untrusted > 0)
			reasons.push('untrusted events in the keyboard typing');
		if (!distinguishable(real.recording, control.recording))
			reasons.push('the keyboard and sendKeys recordings cannot be told apart');
		return { reasons, evidence: { real: summary(real), control: summary(control) } };
	},

	'a long press beside a range across blocks ends it': async (ctx) => {
		await ctx.fresh(ctx.url, LONG);
		await ctx.run(`window.__test.setSelection(${JSON.stringify(RANGE)}); return true`);
		await sleep(800);
		const at = await webToNative(ctx, BELOW_RANGE);
		if (!at) return { reasons: [`no native element for block ${BELOW_RANGE}`] };
		const box = await webBox(ctx, BELOW_RANGE);
		await holdAt(ctx, at(box.left + 20, box.mid));
		await ctx.screenshot('press-beside').catch(() => {});
		const after = await ctx.run(SNAPSHOT);
		const reasons = [];
		const word =
			after.editor && JSON.stringify(after.editor.anchor) !== JSON.stringify(after.editor.focus);
		if (!word || after.editor.anchor.path[0] !== BELOW_RANGE)
			reasons.push(
				`the long press left ${JSON.stringify(after.editor)}, not the word in block ${BELOW_RANGE}`
			);
		if (after.painted > 0) reasons.push(`the old range still paints ${after.painted} rect(s)`);
		return { reasons, evidence: { after } };
	},

	"a range across blocks shows only the editor's handles": async (ctx) => {
		await ctx.fresh(ctx.url, SHORT);
		await ctx.run(`window.__test.setSelection(${JSON.stringify(RANGE)}); return true`);
		await sleep(1200);
		await ctx.screenshot('range-handles').catch(() => {});
		const after = await ctx.run(SNAPSHOT);
		const reasons = [];
		if (!after.nativeCollapsed) reasons.push('a native range stands beside the painted one');
		if (after.handles !== 2) reasons.push(`${after.handles} editor handle(s), not 2`);
		return { reasons, evidence: { after } };
	},

	"a long press's edge handle crosses into the next block": async (ctx) => {
		await ctx.fresh(ctx.url, SHORT);
		const at = await webToNative(ctx, 0);
		if (!at) return { reasons: ['no native element for block 0'] };
		const box = await webBox(ctx, 0);
		// The last word, so the browser's range ends at the block's end.
		await holdAt(ctx, at(box.right - 14, box.mid));
		await sleep(800);
		const handle = await ctx.run(HANDLE_BOX);
		await ctx.screenshot('edge-handle').catch(() => {});
		if (!handle)
			return {
				reasons: ['no editor handle at the block end'],
				evidence: { after: await ctx.run(SNAPSHOT) }
			};
		const next = await webBox(ctx, 1);
		const from = at(handle.x, handle.y);
		const to = at(handle.x + next.left + 40 - handle.pointX, handle.y + next.mid - handle.pointY);
		await ctx.native();
		await ctx.call('POST', ctx.s('/execute/sync'), {
			script: 'mobile: dragFromToForDuration',
			args: [{ duration: 0.3, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y }]
		});
		await sleep(1200);
		await ctx.web();
		await ctx.screenshot('edge-crossed').catch(() => {});
		const after = await ctx.run(SNAPSHOT);
		const reasons = [];
		if (after.editor?.focus.path[0] !== 1)
			reasons.push(`the drag left ${JSON.stringify(after.editor)}`);
		if (!after.nativeCollapsed) reasons.push('a native range stands beside the painted one');
		return { reasons, evidence: { handle, after } };
	}
};

// ── Probes ──────────────────────────

export const probes = {
	// Whether the first tap misses because of something the drag handles do on hover: the same
	// first tap with the handles off, for comparison with the row's.
	'first tap with the drag handles off': async (ctx) => {
		await ctx.fresh(`${ctx.url}?dragHandles=false`, SHORT);
		const log = await logEvents(ctx, async () => ctx.click(await ctx.editable(0)));
		return {
			keyboard: await keyboardShown(ctx),
			selection: await ctx.run('return window.__test.getSelection()'),
			pageEvents: log
		};
	}
};

// ── Steps ──────────────────────────

const SNAPSHOT = `const s = document.getSelection();
	return {
		dom: String(s),
		nativeCollapsed: !s || s.rangeCount === 0 || s.isCollapsed,
		editor: window.__test.getSelection(),
		painted: document.querySelectorAll('.selection-overlay').length,
		handles: document.querySelectorAll('.selection-handle').length
	};`;

// The editor's end handle's centre and the range end it drags, in page coordinates.
const HANDLE_BOX = `const b = document.querySelector('.selection-handle[data-handle="end"]')?.getBoundingClientRect();
	const s = document.getSelection();
	const rects = s && s.rangeCount ? s.getRangeAt(0).getClientRects() : [];
	const last = rects[rects.length - 1];
	return b && last && { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2, pointX: last.right, pointY: (last.top + last.bottom) / 2 };`;

// Block `index`'s text in page coordinates: where its text starts and ends, and its line's middle.
function webBox(ctx, index) {
	return ctx.run(`const ed = document.querySelector('[data-block-path="[${index}]"] [contenteditable="true"]');
		const range = document.createRange();
		range.selectNodeContents(ed);
		const r = range.getBoundingClientRect();
		return { left: r.left, right: r.right, mid: (r.top + r.bottom) / 2 };`);
}

// Page coordinates to native points, through block `index`'s editable and its native element.
async function webToNative(ctx, index) {
	const text = (await ctx.source()).split('\n\n')[index].trimEnd();
	const ed =
		await ctx.run(`const r = document.querySelector('[data-block-path="[${index}]"] [contenteditable="true"]').getBoundingClientRect();
		return { left: r.left, top: r.top, width: r.width };`);
	await ctx.native();
	const el = await ctx.tryFind(
		'-ios predicate string',
		`(label == '${text}' OR value == '${text}') AND type != 'XCUIElementTypeOther'`
	);
	const at = el && (await ctx.call('GET', ctx.s(`/element/${el}/rect`)));
	await ctx.web();
	if (!at) return null;
	const scale = at.width / ed.width;
	return (x, y) => ({
		x: Math.round(at.x + (x - ed.left) * scale),
		y: Math.round(at.y + (y - ed.top) * scale)
	});
}

async function holdAt(ctx, point) {
	await ctx.native();
	await ctx.call('POST', ctx.s('/execute/sync'), {
		script: 'mobile: touchAndHold',
		args: [{ ...point, duration: 1.5 }]
	});
	await sleep(1000);
	await ctx.web();
}

async function keyboardShown(ctx) {
	await ctx.native();
	let shown = false;
	for (let i = 0; i < 40 && !shown; i++) {
		shown = !!(await ctx.tryFind('-ios class chain', '**/XCUIElementTypeKeyboard'));
		if (!shown) await sleep(250);
	}
	await ctx.web();
	return shown;
}

// The editable's centre sits past the end of its short line, so the tap leaves the caret at its
// end. A tap that brings up no keyboard is tried up to three times, each after clearing Safari's
// tip; the first one's page events are kept, since the first tap is the one that misses.
async function tapKeys(ctx, index, typed) {
	typed.tapAttempts = 0;
	let shown = false;
	while (!shown && typed.tapAttempts < 3) {
		typed.tapAttempts++;
		await ctx.dismissSafariTip();
		const tap = async () => ctx.click(await ctx.editable(index));
		if (typed.tapAttempts === 1) typed.firstTapEvents = await logEvents(ctx, tap);
		else await tap();
		shown = await keyboardShown(ctx);
	}
	if (!shown) throw new Error('the soft keyboard never showed after three taps');
	await expectAtCaret(ctx, index, typed);
	await ctx.native();
	const keyFor = (ch) =>
		ctx.tryFind(
			'-ios predicate string',
			`type == 'XCUIElementTypeKey' AND name == '${ch === ' ' ? 'space' : ch}'`
		);
	for (const ch of ` ${WORD} `) {
		const key = await keyFor(ch);
		if (!key) throw new Error(`no XCUIElementTypeKey named ${JSON.stringify(ch)}`);
		await ctx.click(key);
		await sleep(300);
	}
	await ctx.web();
}

async function sendKeys(ctx, index, typed) {
	await ctx.call('POST', ctx.s(`/element/${await ctx.editable(index)}/value`), {
		text: ` ${WORD} `
	});
	await sleep(1000);
	typed.expected = null;
}

async function expectAtCaret(ctx, index, typed) {
	const selection = await ctx.run('return window.__test.getSelection()');
	const before = await ctx.source();
	if (selection?.focus.path[0] !== index)
		throw new Error(`the tap meant for block ${index} landed at ${JSON.stringify(selection)}`);
	const at = before.indexOf(before.split('\n\n')[index]) + selection.focus.offset;
	typed.caret = selection;
	typed.expected = `${before.slice(0, at)} ${WORD} ${before.slice(at)}`;
}

async function record(ctx, name, type) {
	const typed = { name };
	try {
		await ctx.run('window.__test.startInputRecording({ includeText: true }); return true');
		await type(typed);
		for (let i = 0; i < 40 && typed.expected && (await ctx.source()) !== typed.expected; i++)
			await sleep(250);
		typed.actual = await ctx.source();
	} catch (error) {
		typed.error = String(error?.stack ?? error);
	}
	await ctx.screenshot(name).catch(() => {});
	await ctx.web().catch(() => {});
	typed.recording = await ctx.run('return window.__test.stopInputRecording()').catch(() => null);
	writeFileSync(path.join(ctx.out, `${name}.recording.json`), JSON.stringify(typed.recording));
	return typed;
}

// The page's own log of a tap: the mouse events iOS synthesizes after a touch are the question.
async function logEvents(ctx, gesture) {
	await ctx.run(`(() => {
		const log = (window.__eventLog = []);
		const types = ['pointerover', 'pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click', 'focusin', 'selectionchange'];
		for (const type of types)
			document.addEventListener(type, (e) => {
				if (window.__eventLog !== log) return;
				const t = e.target;
				log.push({ type, t: Math.round(e.timeStamp), on: t?.nodeType === 1 ? t.tagName + (t.className ? '.' + String(t.className).split(' ')[0] : '') : '#text' });
			}, true);
		return true;
	})()`);
	await gesture();
	await sleep(1500);
	await ctx.web();
	return ctx.run('return window.__eventLog.slice(0, 60)');
}

function summary(typed) {
	const { recording, ...rest } = typed;
	return { ...rest, shape: shape(recording) };
}
