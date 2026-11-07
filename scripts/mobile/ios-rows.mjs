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

	"a long press makes the editor's range": async (ctx) => {
		await ctx.fresh(ctx.url, SHORT);
		const pressed = await pressWord(ctx, 0, 'takeover');
		if (pressed.reasons) return pressed;
		return { reasons: ownedWordReasons(pressed.after, 0, pressed.menu), evidence: pressed };
	},

	'a long press beside a range across blocks ends it': async (ctx) => {
		await ctx.fresh(ctx.url, LONG);
		await setRange(ctx);
		const pressed = await pressWord(ctx, BELOW_RANGE, 'press-beside');
		if (pressed.reasons) return pressed;
		const reasons = ownedWordReasons(pressed.after, BELOW_RANGE, pressed.menu);
		return { reasons, evidence: pressed };
	},

	"a range across blocks shows only the editor's handles": async (ctx) => {
		await ctx.fresh(ctx.url, SHORT);
		await ctx.run(`window.__test.setSelection(${JSON.stringify(RANGE)}); return true`);
		await sleep(1200);
		await ctx.screenshot('range-handles').catch(() => {});
		const after = await ctx.run(SNAPSHOT);
		const reasons = [];
		if (!after.nativeCollapsed) reasons.push('a native range stands beside the painted one');
		if (after.handles.length !== 2) reasons.push(`${after.handles.length} editor handle(s), not 2`);
		return { reasons, evidence: { after } };
	},

	'the end handle drags a long-pressed word into the next block': async (ctx) => {
		await ctx.fresh(ctx.url, SHORT);
		const pressed = await pressWord(ctx, 0, 'end-press');
		if (pressed.reasons) return pressed;
		const handle = await ctx.run(HANDLE_BOX);
		await ctx.screenshot('end-handle').catch(() => {});
		if (!handle)
			return {
				reasons: ['no editor handle at the end of the long-pressed word'],
				evidence: pressed
			};
		// Mapped again, since the keyboard a caret brings up can scroll the page.
		const at = await webToNative(ctx, 0);
		const next = await webBox(ctx, 1);
		const from = at(handle.x, handle.y);
		const to = at(handle.x + next.left + 40 - handle.pointX, handle.y + next.mid - handle.pointY);
		await mobile(ctx, 'dragFromToForDuration', {
			duration: 0.3,
			fromX: from.x,
			fromY: from.y,
			toX: to.x,
			toY: to.y
		});
		await sleep(1200);
		await ctx.screenshot('end-crossed').catch(() => {});
		const after = await ctx.run(SNAPSHOT);
		const reasons = [];
		if (after.editor?.focus.path[0] !== 1)
			reasons.push(`the drag left ${JSON.stringify(after.editor)}`);
		if (!after.nativeCollapsed) reasons.push('a native range stands beside the painted one');
		return { reasons, evidence: { handle, after } };
	},

	"the toolbar's copy fills the pasteboard": async (ctx) => {
		await ctx.fresh(ctx.url, SHORT);
		await mobile(ctx, 'setPasteboard', { content: 'before the copy', encoding: 'utf8' });
		const pressed = await pressWord(ctx, 1, 'toolbar-copy');
		if (pressed.reasons) return pressed;
		const copy = await ctx.tryFind('css selector', '[data-testid="toolbar-copy"]');
		if (!copy) return { reasons: ['the toolbar showed no Copy'], evidence: pressed };
		await ctx.click(copy);
		await sleep(800);
		const pasteboard = await mobile(ctx, 'getPasteboard', { encoding: 'utf8' });
		const reasons =
			pasteboard === 'gamma' ? [] : [`the pasteboard holds ${JSON.stringify(pasteboard)}`];
		return { reasons, evidence: { pressed, pasteboard } };
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
	const paint = [...document.querySelectorAll('.selection-overlay')];
	return {
		dom: String(s),
		nativeCollapsed: !s || s.rangeCount === 0 || s.isCollapsed,
		editor: window.__test.getSelection(),
		painted: paint.length,
		paintedIn: [...new Set(paint.map((el) => el.closest('[data-block-path]')?.dataset.blockPath ?? null))],
		handles: [...document.querySelectorAll('.selection-handle')].map((h) => h.dataset.handle),
		menus: [...document.querySelectorAll('.md-menu')].map((m) => ({ toolbar: m.classList.contains('selection-toolbar'), items: [...m.querySelectorAll('.md-menu-item')].map((i) => i.textContent.trim()) }))
	};`;

// The editor's end handle's centre and the range end it drags (it hangs below the end, to its
// right), in page coordinates.
const HANDLE_BOX = `const b = document.querySelector('.selection-handle[data-handle="end"]')?.getBoundingClientRect();
	return b && { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2, pointX: b.left, pointY: b.top - 8 };`;

// The range is set through the bridge and read back, so a press beside it is a press beside a
// range that was there; what the row tests is what the touch does to it.
async function setRange(ctx) {
	const json = JSON.stringify;
	await ctx.run(`window.__test.setSelection(${json(RANGE)}); return true`);
	let range = null;
	for (let i = 0; i < 40 && json(range) !== json(RANGE); i++) {
		await sleep(50);
		range = await ctx.run('return window.__test.getSelection()');
	}
	if (json(range) !== json(RANGE))
		throw new Error(`the bridge set ${json(range)}, not ${json(RANGE)}`);
}

// A long press on block `index`'s first word, then what it left: the page's state and Safari's menu.
async function pressWord(ctx, index, name) {
	const at = await webToNative(ctx, index);
	if (!at) return { reasons: [`no native element for block ${index}`] };
	const box = await webBox(ctx, index);
	await holdAt(ctx, at(box.left + 20, box.mid));
	await ctx.screenshot(name).catch(() => {});
	return { after: await ctx.run(SNAPSHOT), menu: await safariMenu(ctx) };
}

// What a long press leaves: the word as the editor's range in block `index`, painted there alone
// with no native range under it, the editor's two handles, and the toolbar as the only menu.
function ownedWordReasons(after, index, menu) {
	const reasons = [];
	const { editor } = after;
	const json = JSON.stringify;
	const inBlock = editor && editor.anchor.path[0] === index && editor.focus.path[0] === index;
	if (!inBlock || json(editor.anchor) === json(editor.focus))
		reasons.push(`the long press left ${json(editor)}, not the word in block ${index}`);
	if (!after.nativeCollapsed) reasons.push('a native range stands under the word');
	if (!after.painted || after.paintedIn.some((path) => path !== `[${index}]`))
		reasons.push(`the paint covers ${json(after.paintedIn)}, not block ${index} alone`);
	if (after.handles.length !== 2) reasons.push(`${after.handles.length} editor handle(s), not 2`);
	if (menu.length) reasons.push(`Safari's own menu shows (${menu.join(', ')})`);
	const menus = after.menus.map((m) => (m.toolbar ? 'toolbar' : 'menu'));
	if (json(menus) !== json(['toolbar']))
		reasons.push(`the editor shows ${json(menus)}, not the toolbar alone`);
	return reasons;
}

// The items of Safari's own edit menu, by label; the editor's menus are web buttons, not these.
async function safariMenu(ctx) {
	await ctx.native();
	const found = await ctx
		.call('POST', ctx.s('/elements'), {
			using: '-ios predicate string',
			value: "type == 'XCUIElementTypeMenuItem'"
		})
		.catch(() => []);
	const labels = [];
	for (const el of found.slice(0, 12))
		labels.push(
			await ctx.call('GET', ctx.s(`/element/${el[ELEMENT]}/attribute/label`)).catch(() => '?')
		);
	await ctx.web();
	return labels;
}

// A `mobile:` command, from the native context it runs in.
async function mobile(ctx, command, args) {
	await ctx.native();
	try {
		return await ctx.call('POST', ctx.s('/execute/sync'), {
			script: `mobile: ${command}`,
			args: [args]
		});
	} finally {
		await ctx.web();
	}
}

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

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
