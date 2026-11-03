// The Android emulator rows, keyed by the scenario each one runs in
// `src/lib/e2e/requirements/mobile/android.md`; the probes are reported and judge nothing. A row
// gets a freshly loaded page and returns the reasons it failed, none when it passed.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { centre, sleep } from './android-device.mjs';
import { distinguishable, shape, softKeyboardReasons } from './judge.mjs';
import {
	BARE_HOST,
	BARE_TEXT,
	COLLAPSE_NOW,
	INSTALL_LOG,
	KEEP_CONTEXTMENU_FROM_EDITOR,
	PROBE_DOC,
	RANGE_END,
	READ_LOG,
	READ_STATE,
	REMOVE_FAR_BLOCK_MID_DRAG,
	bareBlock,
	blockOf,
	brief,
	collapseAt,
	save,
	timeline,
	wordBox,
	writes
} from './touch-probes.mjs';

const WORD = 'hello';
const SHORT = 'alpha beta\n\ngamma delta\n\nepsilon zeta\n';
// Filler below the trial paragraphs gives a swipe something to scroll.
const LONG = `${SHORT}\n${Array.from({ length: 24 }, (_, i) => `filler line ${i + 1}`).join('\n\n')}\n`;
const RANGE = { anchor: { path: [0], offset: 2 }, focus: { path: [1], offset: 5 } };
// The range's formatting toolbar sits over the first paragraphs and takes a tap as a command, so a
// gesture meant for the text lands on `filler line 4`, well below it.
const BELOW_RANGE = 6;
const TABLE = 'lead line\n\n| apple | berry |\n| --- | --- |\n| cherry | damson |\n';

// ── Rows ──────────────────────────

export const rows = {
	'types a word through Gboard': async (ctx) => {
		await ctx.fresh(SHORT);
		const real = await typeWord(ctx, 0, 'gboard', () => typeOnGboard(ctx, 'gboard', 0));
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
	},

	'a long press beside a range across blocks ends it': async (ctx) => {
		const { before, pressed } = await pressBesideRange(ctx, 'press-beside');
		const { editor, painted } = pressed.after;
		const reasons = [];
		const word = editor && !same(editor, { anchor: editor.focus, focus: editor.focus });
		if (!word || editor.anchor.path[0] !== BELOW_RANGE)
			reasons.push(`the long press left ${json(editor)}, not the word in block ${BELOW_RANGE}`);
		if (painted > 0) reasons.push(`the old range still paints ${painted} rect(s)`);
		return { reasons, evidence: { before, ...pressed } };
	},

	"the editor menu's cut takes the long-pressed word": async (ctx) => {
		const { pressed } = await pressBesideRange(ctx, 'menu-cut');
		const cut = ctx.device
			.dumpNodes('menu-cut-menu')
			.find((n) => n.pkg === 'com.android.chrome' && n.text === 'Cut');
		if (!cut) return { reasons: ['the editor menu showed no Cut'], evidence: pressed };
		ctx.device.tap(centre(cut.box).x, centre(cut.box).y);
		await sleep(1000);
		const text = await source(ctx);
		const reasons = [];
		if (!text.startsWith('alpha beta\n\ngamma delta\n\n'))
			reasons.push('Cut took text from the old range across the first two blocks');
		if (lineText(text, BELOW_RANGE) === lineText(LONG, BELOW_RANGE))
			reasons.push(`Cut left block ${BELOW_RANGE} as it was`);
		return {
			reasons,
			evidence: { word: pressed.after.dom.text, after: lineText(text, BELOW_RANGE) }
		};
	},

	"a long press's edge handle crosses into the next block": async (ctx) => {
		await ctx.fresh(LONG);
		await longPress(ctx, 0, 'edge-press');
		// The browser's own end handle, dragged to the block's end, where it stops.
		const end = await rangeEndOnScreen(ctx, 0);
		if (end) ctx.device.swipe(end.x + 4, end.bottom + 25, end.x + 400, end.bottom + 25, 800);
		await sleep(1000);
		const atEdge = await ctx.page.evaluate(SNAPSHOT);
		const handle = await handleOnScreen(ctx, 0, 'end');
		ctx.device.screenshot('edge-handle');
		if (!handle)
			return {
				reasons: ['no editor handle at the block end'],
				evidence: { atEdge, page: await ctx.page.evaluate(HANDLES_STATE) }
			};
		const next = await ctx.device.paragraphBox(lineText(await source(ctx), 1), 'edge-next');
		const to = { x: next.x1 + 120, y: centre(next).y };
		const log = await logPointers(ctx, async () =>
			ctx.device.swipe(
				handle.x,
				handle.y,
				handle.x + to.x - handle.pointX,
				handle.y + to.y - handle.pointY,
				800
			)
		);
		ctx.device.screenshot('edge-crossed');
		const after = await ctx.page.evaluate(SNAPSHOT);
		const reasons = [];
		if (!log.counts.pointerdown) reasons.push("the swipe never reached the editor's handle");
		if (after.editor?.focus.path[0] !== 1) reasons.push(`the swipe left ${json(after.editor)}`);
		if (!after.nativeCollapsed) reasons.push('a native range stands beside the painted one');
		return { reasons, evidence: { atEdge, handle, after, pointerLog: log } };
	},

	'a handle swipe across cells grows a rectangle': async (ctx) => {
		await ctx.fresh(TABLE);
		const toScreen = await screenMap(ctx, 0);
		const cell = (row, col) =>
			ctx.page.evaluate(`(() => {
				const cells = document.querySelectorAll('[role="table"] [data-table-row-idx="${row}"] > :is([role="cell"], [role="columnheader"])');
				const r = cells[${col}].getBoundingClientRect();
				return { x: r.left + 24, y: (r.top + r.bottom) / 2, cx: (r.left + r.right) / 2 };
			})()`);
		const apple = await cell(0, 0);
		const press = toScreen(apple.x, apple.y);
		await pressReport(ctx, 'cells-press', () =>
			ctx.device.swipe(press.x, press.y, press.x, press.y, 1500)
		);
		const handle = await handleOnScreen(ctx, 0, 'end');
		ctx.device.screenshot('cells-handle');
		if (!handle)
			return {
				reasons: ['no editor handle at the cell end'],
				evidence: { page: await ctx.page.evaluate(HANDLES_STATE) }
			};
		const damson = await cell(1, 1);
		const to = toScreen(damson.cx, damson.y);
		ctx.device.swipe(
			handle.x,
			handle.y,
			handle.x + to.x - handle.pointX,
			handle.y + to.y - handle.pointY,
			800
		);
		await sleep(1200);
		ctx.device.screenshot('cells-rectangle');
		const after = await ctx.page.evaluate('window.__test.getSelection()');
		const want = {
			anchor: { path: [1], offset: 0, cellCoordinate: true },
			focus: { path: [1], offset: 3, cellCoordinate: true }
		};
		const reasons = json(after) === json(want) ? [] : [`the swipe left ${json(after)}`];
		return { reasons, evidence: { after } };
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
		const typed = await typeWord(ctx, 2, 'spellcheck-on', () =>
			typeOnGboard(ctx, 'spellcheck-on', 2)
		);
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

	// Whether the editor can take a long press's word over: Chrome's menu after a collapse, Gboard
	// over a painted range, one shared host for contrast. Each saves `<slug>.json`.
	"5 one menu: the editor's menu, no collapse": (ctx) => oneMenu(ctx, 'p5-editor', {}),
	"5 one menu: the editor's menu, collapsed at the pointercancel": (ctx) =>
		oneMenu(ctx, 'p5-editor-cancel', { collapse: { end: 'pointercancel', moment: 'sync' } }),
	"5 one menu: the editor's menu, collapsed a task after the pointercancel": (ctx) =>
		oneMenu(ctx, 'p5-editor-task', { collapse: { end: 'pointercancel', moment: 'task' } }),
	"5 one menu: the editor's menu, collapsed after the lift": (ctx) =>
		oneMenu(ctx, 'p5-editor-lift', { lift: true }),
	"5 one menu: chrome's menu, no collapse": (ctx) => oneMenu(ctx, 'p5-chrome', { chrome: true }),
	"5 one menu: chrome's menu, collapsed at the pointercancel": (ctx) =>
		oneMenu(ctx, 'p5-chrome-cancel', {
			chrome: true,
			collapse: { end: 'pointercancel', moment: 'sync' }
		}),
	"5 one menu: chrome's menu, collapsed after the lift": (ctx) =>
		oneMenu(ctx, 'p5-chrome-lift', { chrome: true, lift: true }),

	'6 gboard over a painted range: one letter': (ctx) =>
		gboardOverPaint(ctx, 'p6-letter', { typed: 'x' }),
	'6 gboard over a painted range: a misspelt word, spellcheck on': (ctx) =>
		gboardOverPaint(ctx, 'p6-word', { typed: 'teh ', spellcheck: true }),
	'6 gboard over a painted range: one letter, after a long press': (ctx) =>
		gboardOverPaint(ctx, 'p6-after-press', { typed: 'x', longPress: true }),

	"7 a shared host: chrome's handle from the first block into the third": (ctx) =>
		sharedHost(ctx, 'p7-across', {}),
	'7 a shared host: a far block removed mid-drag': (ctx) =>
		sharedHost(ctx, 'p7-far-removed', { removeFar: true }),
	'7 a shared host: gboard composes a word in the second block': (ctx) =>
		composeInHost(ctx, 'p7-compose')
};

// A long press on a word mid-block, read twice. `chrome` keeps contextmenu from the editor, so
// Chrome shows its menu; `collapse` collapses at a moment of the press, `lift` after the lift.
async function oneMenu(ctx, slug, { chrome = false, collapse = null, lift = false }) {
	await ctx.fresh(PROBE_DOC);
	await ctx.page.evaluate(INSTALL_LOG);
	if (chrome) await ctx.page.evaluate(KEEP_CONTEXTMENU_FROM_EDITOR);
	if (collapse) await ctx.page.evaluate(collapseAt(collapse));
	const pressed = await holdWord(ctx, blockOf(1), 'six', await screenMap(ctx, 1));
	if (lift) await ctx.page.evaluate(COLLAPSE_NOW);
	await sleep(500);
	const soon = await look(ctx, `${slug}-500ms`);
	await sleep(1000);
	const later = await look(ctx, `${slug}-1500ms`);
	const log = await ctx.page.evaluate(READ_LOG);
	const timing = writes(log, 'pointercancel');
	const file = save(ctx.out, slug, {
		chrome,
		collapse,
		lift,
		pressed,
		timing,
		soon,
		later,
		timeline: timeline(log),
		log
	});
	return {
		file,
		timing,
		events: timeline(log).slice(0, 30),
		soon: brief(soon),
		later: brief(later)
	};
}

// A tap for the keyboard, a range across two blocks painted beside a collapsed caret, then Gboard's
// keys. Missing keys get no re-tap, since a tap would clear the range.
async function gboardOverPaint(ctx, slug, { typed, spellcheck = false, longPress = false }) {
	await ctx.fresh(SHORT);
	await ctx.page.evaluate(INSTALL_LOG);
	if (spellcheck)
		await ctx.page.evaluate(
			`document.querySelectorAll('[contenteditable="true"]').forEach((el) => (el.spellcheck = true))`
		);
	await tapCaret(ctx, 1, slug);
	const steps = {};
	if (longPress) {
		await holdWord(ctx, blockOf(0), 'alpha', await screenMap(ctx, 0));
		await sleep(800);
		steps.pressed = await look(ctx, `${slug}-pressed`);
	}
	await ctx.page.evaluate(`window.__test.setSelection(${json(RANGE)})`);
	await sleep(800);
	steps.painted = await look(ctx, `${slug}-painted`);
	const keys = ctx.device.gboardKeys(`${slug}-keys`);
	const missing = [...new Set(typed)].filter((ch) => !keys.has(ch));
	if (missing.length) {
		const file = save(ctx.out, slug, { typed, steps, gboard: ctx.device.gboardMode() });
		return {
			file,
			error: `Gboard showed no keys for ${json(missing)} over the painted range`,
			painted: brief(steps.painted)
		};
	}
	await ctx.page.evaluate('window.__test.startInputRecording({ includeText: true })');
	const strips = [];
	for (const [i, ch] of [...typed].entries()) {
		ctx.device.tap(keys.get(ch).x, keys.get(ch).y);
		await sleep(500);
		ctx.device.screenshot(`${slug}-key-${i + 1}`);
		strips.push({
			typed: typed.slice(0, i + 1),
			source: await source(ctx),
			strip: suggestions(ctx, `${slug}-key-${i + 1}`)
		});
	}
	await sleep(1500);
	ctx.device.screenshot(`${slug}-typed`);
	const recording = await ctx.page.evaluate('window.__test.stopInputRecording()').catch(() => null);
	writeFileSync(path.join(ctx.out, `${slug}.recording.json`), json(recording));
	const text = await source(ctx);
	const [head, tail] = [SHORT.slice(0, 2), SHORT.slice(17)];
	const landed =
		text.startsWith(head) && text.endsWith(tail)
			? text.slice(head.length, text.length - tail.length)
			: null;
	const log = await ctx.page.evaluate(READ_LOG);
	const file = save(ctx.out, slug, { typed, steps, strips, text, timeline: timeline(log), log });
	return {
		file,
		landed,
		source: text,
		strips,
		inputEvents: timeline(log.filter((r) => /^(beforeinput|input|composition)/.test(r.type ?? ''))),
		painted: brief(steps.painted),
		pressed: brief(steps.pressed)
	};
}

// One editing host over plain blocks: a long press in the first, then Chrome's end handle dragged
// into the third. `removeFar` removes the last block the moment the range leaves the first.
async function sharedHost(ctx, slug, { removeFar = false }) {
	const toScreen = await bareHostPage(ctx);
	if (removeFar) await ctx.page.evaluate(REMOVE_FAR_BLOCK_MID_DRAG);
	const pressed = await holdWord(ctx, bareBlock(0), 'alpha', toScreen);
	await sleep(800);
	const press = await look(ctx, `${slug}-press`);
	const end = await ctx.page.evaluate(RANGE_END);
	const target = await ctx.page.evaluate(wordBox(bareBlock(2), 'epsilon'));
	if (!end || !target) {
		const file = save(ctx.out, slug, { pressed, press, end, target });
		return { file, error: 'no range end or no target after the long press', press: brief(press) };
	}
	// Chrome hangs its end handle below the range end, and the range follows the handle's top.
	const from = toScreen(end.right, end.bottom);
	const to = toScreen(target.x, target.y);
	const dragAt = await ctx.page.evaluate('window.__probe.now()');
	ctx.device.swipe(from.x + 4, from.y + 25, to.x, to.y + 25, 800);
	await sleep(1200);
	const dragged = await look(ctx, `${slug}-dragged`);
	const blocks = await ctx.page.evaluate(BARE_TEXT);
	const log = await ctx.page.evaluate(READ_LOG);
	const file = save(ctx.out, slug, {
		removeFar,
		pressed,
		press,
		from,
		to,
		dragged,
		blocks,
		timeline: timeline(log),
		log
	});
	return {
		file,
		press: brief(press),
		dragged: brief(dragged),
		dragEvents: timeline(log.filter((r) => r.at >= dragAt)).slice(0, 24)
	};
}

// A tap past the end of the shared host's second block, then Gboard's own keys.
async function composeInHost(ctx, slug) {
	const toScreen = await bareHostPage(ctx);
	const word = await ctx.page.evaluate(wordBox(bareBlock(1), 'delta'));
	const at = toScreen(word.right + 40, word.y);
	ctx.device.tap(at.x, at.y);
	for (let i = 0; i < 40 && !ctx.device.imeShown(); i++) await sleep(250);
	await sleep(500);
	const tapped = await look(ctx, `${slug}-tapped`);
	const keys = ctx.device.gboardKeys(`${slug}-keys`);
	if (!keys.has('h') || !keys.has(' ')) {
		const file = save(ctx.out, slug, { tapped, gboard: ctx.device.gboardMode() });
		return { file, error: 'Gboard showed no keys in the shared host', tapped: brief(tapped) };
	}
	for (const ch of ` ${WORD} `) {
		ctx.device.tap(keys.get(ch).x, keys.get(ch).y);
		await sleep(400);
	}
	await sleep(1500);
	ctx.device.screenshot(`${slug}-typed`);
	const typed = await ctx.page.evaluate(BARE_TEXT);
	await ctx.device.hideKeyboard();
	const afterHide = await ctx.page.evaluate(BARE_TEXT);
	const log = await ctx.page.evaluate(READ_LOG);
	const file = save(ctx.out, slug, { tapped, typed, afterHide, timeline: timeline(log), log });
	const plain = (blocks) => blocks.map((b) => b.text.replace(/\s/g, ' '));
	return {
		file,
		committed: plain(afterHide)[1] === `second block gamma delta ${WORD} `,
		typed: plain(typed),
		afterHide: plain(afterHide),
		inputEvents: timeline(log.filter((r) => /^(beforeinput|input|composition)/.test(r.type ?? '')))
	};
}

// ── Probe steps ──────────────────────────

// The bare page, with the screen map measured on the harness before it: the bare page has no block
// for the lookup, and a viewport point maps to the screen the same way on both.
async function bareHostPage(ctx) {
	await ctx.fresh(SHORT);
	const toScreen = await screenMap(ctx, 0);
	await ctx.page.evaluate(BARE_HOST);
	await sleep(1000);
	await ctx.page.evaluate(INSTALL_LOG);
	return toScreen;
}

// A finger held 1.5 s on `word` under `selector`, then lifted.
async function holdWord(ctx, selector, word, toScreen) {
	const box = await ctx.page.evaluate(wordBox(selector, word));
	if (!box) throw new Error(`no "${word}" under ${selector}`);
	const point = toScreen(box.x, box.y);
	ctx.device.swipe(point.x, point.y, point.x, point.y, 1500);
	return { box, point };
}

// A moment after a gesture: a screenshot, the page's state, the keyboard and every menu on screen.
async function look(ctx, name) {
	const shotAt = await ctx.page.evaluate('window.__probe.now()').catch(() => null);
	ctx.device.screenshot(name);
	const state = await ctx.page.evaluate(READ_STATE);
	return {
		shot: `${name}.png`,
		shotAt,
		...state,
		keyboard: ctx.device.imeShown(),
		menuNodes: menuNodes(ctx, name)
	};
}

const MENU_WORDS = new Set([
	'Cut',
	'Copy',
	'Paste',
	'Paste as plain text',
	'Select all',
	'Share',
	'Web search',
	'Translate',
	'Search',
	'Listen',
	'Define'
]);

// Every menu item on screen, from a dump of every window, and whether it sits inside Chrome's web
// content (a page's menu, the editor's) or outside it (Chrome's own floating toolbar).
function menuNodes(ctx, name) {
	try {
		ctx.device.dumpNodes(`${name}-windows`, '--windows');
	} catch (error) {
		return [{ error: String(error).split('\n')[0] }];
	}
	const xml = readFileSync(path.join(ctx.out, `${name}-windows.xml`), 'utf8');
	const open = [];
	const found = [];
	for (const [tag, selfClosing] of xml.matchAll(/<node\b[^>]*?(\/?)>|<\/node>/g)) {
		if (tag === '</node>') {
			open.pop();
			continue;
		}
		const attr = (key) => tag.match(new RegExp(` ${key}="([^"]*)"`))?.[1] ?? '';
		const node = {
			text: attr('text'),
			desc: attr('content-desc'),
			cls: attr('class'),
			id: attr('resource-id'),
			pkg: attr('package'),
			bounds: attr('bounds')
		};
		if (MENU_WORDS.has(node.text || node.desc))
			found.push({ ...node, inPage: open.some((n) => n.cls === 'android.webkit.WebView') });
		if (!selfClosing) open.push(node);
	}
	return found;
}

// The texts Gboard shows above its keys (the suggestion strip) after a key.
function suggestions(ctx, name) {
	try {
		return ctx.device
			.dumpNodes(`${name}-windows`, '--windows')
			.filter((n) => n.pkg.includes('inputmethod') && n.text)
			.map((n) => n.text);
	} catch (error) {
		return [String(error).split('\n')[0]];
	}
}

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
		const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'click', 'contextmenu', 'selectstart', 'selectionchange'];
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

// A range across the first two blocks, then a long press on a word in block BELOW_RANGE.
async function pressBesideRange(ctx, name) {
	await ctx.fresh(LONG);
	await tapCaret(ctx, 0, name);
	await ctx.device.hideKeyboard();
	const before = await setRange(ctx);
	return { before, pressed: await longPress(ctx, BELOW_RANGE, name) };
}

// A held finger: `input swipe` from a point on block `index`'s first word to itself.
async function longPress(ctx, index, name) {
	const box = await ctx.device.paragraphBox(lineText(await source(ctx), index), `${name}-target`);
	const [x, y] = [box.x1 + 50, centre(box).y].map(Math.round);
	return pressReport(ctx, name, () => ctx.device.swipe(x, y, x, y, 1500));
}

// What a gesture leaves: the page's selection and the editor's, and what the overlay paints.
async function pressReport(ctx, name, gesture) {
	const pointerLog = await logPointers(ctx, async () => gesture());
	ctx.device.screenshot(name);
	return { after: await ctx.page.evaluate(SNAPSHOT), pointerLog };
}

// What a missing handle leaves to read: the handles drawn, the selection, the end block's markup.
const HANDLES_STATE = `(() => {
	const s = document.getSelection();
	const block = s && s.focusNode && s.focusNode.parentElement?.closest('[contenteditable="true"]');
	return {
		handles: [...document.querySelectorAll('.selection-handle')].map((h) => h.dataset.handle + ' ' + h.className + ' ' + h.style.cssText),
		editor: window.__test.getSelection(),
		active: document.activeElement?.className ?? null,
		html: block ? block.innerHTML.slice(-300) : null,
		focus: s && [s.focusNode?.nodeName, s.focusOffset, s.anchorNode?.nodeName, s.anchorOffset]
	};
})()`;

const SNAPSHOT = `(() => {
	const s = document.getSelection();
	return {
		dom: { text: String(s) },
		nativeCollapsed: !s || s.rangeCount === 0 || s.isCollapsed,
		editor: window.__test.getSelection(),
		painted: document.querySelectorAll('.selection-overlay').length
	};
})()`;

// Page coordinates to screen pixels, through block `index`'s editable and its screen box.
async function screenMap(ctx, index) {
	const box = await ctx.device.paragraphBox(lineText(await source(ctx), index), 'screen-map');
	const ed = await ctx.page.evaluate(`(() => {
		const r = document.querySelector('[data-block-path="[${index}]"] [contenteditable="true"]').getBoundingClientRect();
		return { left: r.left, top: r.top, width: r.width };
	})()`);
	const scale = (box.x2 - box.x1) / ed.width;
	return (x, y) => ({ x: box.x1 + (x - ed.left) * scale, y: box.y1 + (y - ed.top) * scale });
}

// The editor's handle at `end` in screen pixels: its centre, and the range end it drags.
async function handleOnScreen(ctx, index, end) {
	const toScreen = await screenMap(ctx, index);
	const r = await ctx.page.evaluate(`(() => {
		const b = document.querySelector('.selection-handle[data-handle="${end}"]')?.getBoundingClientRect();
		return b && { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
	})()`);
	if (!r) return null;
	const at = toScreen(r.x, r.y);
	const point = await rangeEndOnScreen(ctx, index);
	return { x: at.x, y: at.y, pointX: point?.x ?? at.x, pointY: point?.mid ?? at.y };
}

// The live range's end in screen pixels.
async function rangeEndOnScreen(ctx, index) {
	const toScreen = await screenMap(ctx, index);
	const r = await ctx.page.evaluate(`(() => {
		const s = document.getSelection();
		if (!s || s.rangeCount === 0) return null;
		const rects = s.getRangeAt(0).getClientRects();
		const last = rects[rects.length - 1];
		return last && { x: last.right, top: last.top, bottom: last.bottom };
	})()`);
	if (!r) return null;
	const top = toScreen(r.x, r.top);
	const bottom = toScreen(r.x, r.bottom);
	return { x: top.x, bottom: bottom.y, mid: (top.y + bottom.y) / 2 };
}

// Types on Gboard's own keys. A keyboard that isn't on screen is brought up by tapping the caret's
// paragraph again, since a tap at a key's spot would land on the page instead.
async function typeOnGboard(ctx, name, index) {
	let keys = ctx.device.gboardKeys(`${name}-windows`);
	for (let attempt = 1; !keys.has('h') && attempt <= 2; attempt++) {
		await tapCaret(ctx, index, `${name}-retap`);
		keys = ctx.device.gboardKeys(`${name}-windows`);
	}
	ctx.device.screenshot(`${name}-keyboard`);
	if (!keys.has('h') || !keys.has(' '))
		throw new Error(`Gboard never showed its keys on screen (${ctx.device.gboardMode()})`);
	for (const ch of ` ${WORD} `) {
		ctx.device.tap(keys.get(ch).x, keys.get(ch).y);
		await sleep(400);
	}
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
