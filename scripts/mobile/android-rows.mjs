// The Android emulator rows, keyed by the scenario each one runs in
// `src/lib/e2e/requirements/mobile/android.md`; the probes are reported and judge nothing. A row
// gets a freshly loaded page and returns the reasons it failed, none when it passed.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { centre, HARNESS_URL, sleep } from './android-device.mjs';
import { distinguishable, shape, softKeyboardReasons } from './judge.mjs';

const WORD = 'hello';
const SHORT = 'alpha beta\n\ngamma delta\n\nepsilon zeta\n';
// Filler below the trial paragraphs gives a swipe something to scroll.
const LONG = `${SHORT}\n${Array.from({ length: 24 }, (_, i) => `filler line ${i + 1}`).join('\n\n')}\n`;
const RANGE = { anchor: { path: [0], offset: 2 }, focus: { path: [1], offset: 5 } };
// The range's formatting toolbar sits over the first paragraphs and takes a tap as a command, so a
// gesture meant for the text lands on `filler line 4`, well below it.
const BELOW_RANGE = 6;
const TABLE = 'lead line\n\n| apple | berry |\n| --- | --- |\n| cherry | damson |\n';
// `epsilon zeta`: the paste row's second word.
const PASTE_INTO = 2;
// A table of contents a dozen headings long, most of a phone's screen, on the page with plugins.
const HEADINGS = Array.from({ length: 12 }, (_, i) => `## Heading number ${i + 1}`);
const OUTLINE = `alpha beta gamma\n\n[[toc]]\n\n${HEADINGS.join('\n\n')}\n`;
const OUTLINE_URL = HARNESS_URL.replace('/test/editor', '/test/plugins?seed=toc');
// Past a block's top edge by more than a line and well short of its middle.
const PAST_EDGE = 40;

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

	"a long press makes the editor's range": async (ctx) => {
		await ctx.fresh(LONG);
		const pressed = await longPress(ctx, 0, 'takeover');
		const nodes = menuNodes(ctx, 'takeover-menus');
		return { reasons: ownedWordReasons(pressed.after, 0, nodes), evidence: { ...pressed, nodes } };
	},

	'a long press beside a range across blocks ends it': async (ctx) => {
		const { before, pressed } = await pressBesideRange(ctx, 'press-beside');
		const reasons = ownedWordReasons(
			pressed.after,
			BELOW_RANGE,
			menuNodes(ctx, 'press-beside-menus')
		);
		return { reasons, evidence: { before, ...pressed } };
	},

	"the toolbar's cut takes the long-pressed word": async (ctx) => {
		const { pressed } = await pressBesideRange(ctx, 'toolbar-cut');
		const word = rangeIn(pressed.after.editor, BELOW_RANGE);
		if (!word) {
			const left = json(pressed.after.editor);
			return { reasons: [`the long press left ${left}, not a word in block ${BELOW_RANGE}`] };
		}
		if (!(await tapToolbar(ctx, 'cut', BELOW_RANGE)))
			return { reasons: ['the toolbar showed no Cut'], evidence: pressed };
		const before = lineText(LONG, BELOW_RANGE);
		const want = before.slice(0, word.start) + before.slice(word.end);
		let text = await source(ctx);
		for (let i = 0; i < 40 && lineText(text, BELOW_RANGE) === before; i++) {
			await sleep(250);
			text = await source(ctx);
		}
		const after = lineText(text, BELOW_RANGE);
		const reasons = [];
		if (!text.startsWith('alpha beta\n\ngamma delta\n\n'))
			reasons.push('Cut took text from the old range across the first two blocks');
		if (after !== want)
			reasons.push(`Cut left block ${BELOW_RANGE} as ${json(after)}, not ${json(want)}`);
		return { reasons, evidence: { word: before.slice(word.start, word.end), after } };
	},

	"the toolbar's paste puts a copied word in place of another": async (ctx) => {
		await ctx.fresh(LONG);
		await longPress(ctx, 0, 'toolbar-copy');
		if (!(await tapToolbar(ctx, 'copy', 0))) return { reasons: ['the toolbar showed no Copy'] };
		await sleep(800);
		// A copy brings up Android's clipboard chip at the bottom left, which takes the first touch
		// near it, so the word pasted over sits well above it and a press the page never heard is
		// made again.
		let pressed = await longPress(ctx, PASTE_INTO, 'toolbar-paste');
		const missed = !pressed.pointerLog.counts.pointerdown;
		if (missed) pressed = await longPress(ctx, PASTE_INTO, 'toolbar-paste-again');
		if (!(await tapToolbar(ctx, 'paste', PASTE_INTO)))
			return { reasons: ['the toolbar showed no Paste'], evidence: { missed, ...pressed } };
		const want = lineText(LONG, PASTE_INTO).replace('epsilon', 'alpha');
		const prompt = await allowClipboardRead(ctx, 'toolbar-paste', async () => {
			return lineText(await source(ctx), PASTE_INTO) === want;
		});
		await sleep(1000);
		const after = lineText(await source(ctx), PASTE_INTO);
		const reasons = after === want ? [] : [`Paste left block ${PASTE_INTO} reading ${json(after)}`];
		return { reasons, evidence: { missed, prompt, after } };
	},

	'the end handle drags a long-pressed word into the next block': async (ctx) => {
		await ctx.fresh(LONG);
		await longPress(ctx, 0, 'end-press');
		const handle = await handleOnScreen(ctx, 0, 'end');
		ctx.device.screenshot('end-handle');
		if (!handle)
			return {
				reasons: ['no editor handle at the end of the long-pressed word'],
				evidence: { page: await ctx.page.evaluate(HANDLES_STATE) }
			};
		const next = await ctx.device.paragraphBox(lineText(await source(ctx), 1), 'end-next');
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
		ctx.device.screenshot('end-crossed');
		const after = await ctx.page.evaluate(SNAPSHOT);
		const reasons = [];
		if (!log.counts.pointerdown) reasons.push("the swipe never reached the editor's handle");
		if (after.editor?.focus.path[0] !== 1) reasons.push(`the swipe left ${json(after.editor)}`);
		if (!after.nativeCollapsed) reasons.push('a native range stands beside the painted one');
		return { reasons, evidence: { handle, after, pointerLog: log } };
	},

	"a long press in a table cell makes the editor's range": async (ctx) => {
		await ctx.fresh(TABLE);
		const toScreen = await screenMap(ctx, 0);
		const apple = await ctx.page.evaluate(cellPoint(0, 0));
		const press = toScreen(apple.x, apple.y);
		const pressed = await pressReport(ctx, 'cells-press', () =>
			ctx.device.swipe(press.x, press.y, press.x, press.y, 1500)
		);
		const nodes = menuNodes(ctx, 'cells-menus');
		const reasons = ownedWordReasons(pressed.after, 1, nodes, [1, 0, 0]);
		return { reasons, evidence: { ...pressed, nodes } };
	},

	'the cell menu button deletes a row': async (ctx) => {
		await ctx.fresh(TABLE);
		const cherry = await ctx.page.evaluate(cellPoint(1, 0));
		const tapped = (await screenMap(ctx, 0))(cherry.x, cherry.y);
		ctx.device.tap(tapped.x, tapped.y);
		await sleep(1500);
		const button = await ctx.page.evaluate(boxOf('.table-cell-menu'));
		ctx.device.screenshot('cell-button');
		if (!button) return { reasons: ['no cell menu button after a tap in a cell'] };
		const at = (await screenMap(ctx, 0))(button.x, button.y);
		ctx.device.tap(at.x, at.y);
		await sleep(1000);
		ctx.device.screenshot('cell-button-menu');
		const del = await ctx.page.evaluate(menuItemBox('Delete row'));
		if (!del) return { reasons: ['the button opened no menu with Delete row'] };
		const delAt = (await screenMap(ctx, 0))(del.x, del.y);
		ctx.device.tap(delAt.x, delAt.y);
		await sleep(1000);
		const after = await source(ctx);
		const reasons = after.includes('cherry') ? [`Delete row left ${json(after)}`] : [];
		return { reasons, evidence: { after } };
	},

	'the end handle joins a tall outline a line past its edge': async (ctx) => {
		await ctx.fresh(OUTLINE, OUTLINE_URL);
		await longPress(ctx, 0, 'outline-press');
		const handle = await handleOnScreen(ctx, 0, 'end');
		if (!handle) return { reasons: ['no editor handle at the end of the long-pressed word'] };
		const top = await ctx.page.evaluate(
			`document.querySelector("[data-block-path='[1]']").getBoundingClientRect().top`
		);
		const into = (await screenMap(ctx, 0))(0, top + PAST_EDGE).y;
		const log = await logPointers(ctx, async () =>
			ctx.device.swipe(handle.x, handle.y, handle.x, handle.y + into - handle.pointY, 800)
		);
		ctx.device.screenshot('outline-joined');
		const after = await ctx.page.evaluate(SNAPSHOT);
		const reasons = [];
		if (!log.counts.pointerdown) reasons.push("the swipe never reached the editor's handle");
		if (after.editor?.focus.path[0] !== 1)
			reasons.push(`a drag a line into the outline left ${json(after.editor)}`);
		return { reasons, evidence: { handle, after, pointerLog: log } };
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
// The span a range covers inside block `index`, or null when it is empty or leaves the block.
const rangeIn = (sel, index) => {
	if (sel?.anchor.path[0] !== index || sel.focus.path[0] !== index) return null;
	const [start, end] = [sel.anchor.offset, sel.focus.offset].sort((a, b) => a - b);
	return start < end ? { start, end } : null;
};
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
	const paint = [...document.querySelectorAll('.selection-overlay')];
	return {
		dom: { text: String(s) },
		nativeCollapsed: !s || s.rangeCount === 0 || s.isCollapsed,
		editor: window.__test.getSelection(),
		painted: paint.length,
		paintedIn: [...new Set(paint.map((el) => el.closest('[data-block-path]')?.dataset.blockPath ?? null))],
		handles: [...document.querySelectorAll('.selection-handle')].map((h) => h.dataset.handle),
		menus: [...document.querySelectorAll('.md-menu')].map((m) => ({ toolbar: m.classList.contains('selection-toolbar'), items: [...m.querySelectorAll('.md-menu-item')].map((i) => i.textContent.trim()) }))
	};
})()`;

// The centre of the element `selector` names, in page coordinates.
const boxOf = (selector) => `(() => {
	const b = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
	return b && { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
})()`;

// The middle of the first word in the table's cell at `row`, `col`, in page coordinates.
const cellPoint = (row, col) => `(() => {
	const cell = document.querySelectorAll('[role="table"] [data-table-row-idx="${row}"] > :is([role="cell"], [role="columnheader"])')[${col}];
	const r = cell.getBoundingClientRect();
	return { x: r.left + 24, y: (r.top + r.bottom) / 2 };
})()`;

// The centre of the open menu's row labelled `label`, in page coordinates.
const menuItemBox = (label) => `(() => {
	const item = [...document.querySelectorAll('.md-menu-item')].find((i) => i.textContent.trim() === ${JSON.stringify(label)});
	const b = item?.getBoundingClientRect();
	return b && { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
})()`;

// A tap on the toolbar's `action` row, mapped to the screen through block `index`; false when the
// toolbar shows no such row.
async function tapToolbar(ctx, action, index) {
	const row = await ctx.page.evaluate(boxOf(`[data-testid="toolbar-${action}"]`));
	if (!row) return false;
	const at = (await screenMap(ctx, index))(row.x, row.y);
	ctx.device.tap(at.x, at.y);
	return true;
}

// Chrome asks once per site before a page reads the clipboard; this taps Allow on that prompt, and
// stops early once `landed` says the read went through without one.
async function allowClipboardRead(ctx, name, landed) {
	for (let i = 0; i < 16; i++) {
		const allow = ctx.device.dumpNodes(`${name}-prompt`).find((n) => /^Allow/.test(n.text));
		if (allow) {
			ctx.device.screenshot(`${name}-prompt`);
			ctx.device.tap(centre(allow.box).x, centre(allow.box).y);
			return { shown: allow.text, afterTries: i + 1 };
		}
		if (await landed()) return { shown: null, afterTries: i + 1 };
		await sleep(500);
	}
	return { shown: null, afterTries: 16 };
}

// What a long press leaves: the word as the editor's range at `path` (a cell's, inside a table),
// painted in block `index` alone with no native range under it, the editor's two handles, and
// the toolbar as the only menu.
function ownedWordReasons(after, index, nodes, path = [index]) {
	const reasons = [];
	const { editor } = after;
	const inBlock =
		editor && json(editor.anchor.path) === json(path) && json(editor.focus.path) === json(path);
	if (!inBlock || same(editor, { anchor: editor.focus, focus: editor.focus }))
		reasons.push(`the long press left ${json(editor)}, not the word at ${json(path)}`);
	if (!after.nativeCollapsed) reasons.push('a native range stands under the word');
	if (!after.painted || after.paintedIn.some((path) => path !== `[${index}]`))
		reasons.push(`the paint covers ${json(after.paintedIn)}, not block ${index} alone`);
	if (after.handles.length !== 2) reasons.push(`${after.handles.length} editor handle(s), not 2`);
	const chrome = nodes.filter((n) => !n.inPage).map((n) => n.text || n.desc);
	if (chrome.length) reasons.push(`Chrome's own menu shows (${chrome.join(', ')})`);
	const menus = after.menus.map((m) => (m.toolbar ? 'toolbar' : 'menu'));
	if (json(menus) !== json(['toolbar']))
		reasons.push(`the editor shows ${json(menus)}, not the toolbar alone`);
	return reasons;
}

const MENU_WORDS = new Set(['Cut', 'Copy', 'Paste', 'Paste as plain text', 'Select all', 'Share']);

// Every menu item on screen, from a dump of every window, and whether it sits inside Chrome's web
// content (the editor's) or outside it (Chrome's own floating toolbar).
function menuNodes(ctx, name) {
	ctx.device.dumpNodes(name, '--windows');
	const xml = readFileSync(path.join(ctx.out, `${name}.xml`), 'utf8');
	const open = [];
	const found = [];
	for (const [tag, selfClosing] of xml.matchAll(/<node\b[^>]*?(\/?)>|<\/node>/g)) {
		if (tag === '</node>') {
			open.pop();
			continue;
		}
		const attr = (key) => tag.match(new RegExp(` ${key}="([^"]*)"`))?.[1] ?? '';
		const node = { text: attr('text'), desc: attr('content-desc'), cls: attr('class') };
		if (MENU_WORDS.has(node.text || node.desc))
			found.push({ ...node, inPage: open.some((n) => n.cls === 'android.webkit.WebView') });
		if (!selfClosing) open.push(node);
	}
	return found;
}

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

// The editor's handle at `end` in screen pixels: its centre, and the range end it drags, which it
// hangs below, beside the end's side.
async function handleOnScreen(ctx, index, end) {
	const toScreen = await screenMap(ctx, index);
	const r = await ctx.page.evaluate(`(() => {
		const b = document.querySelector('.selection-handle[data-handle="${end}"]')?.getBoundingClientRect();
		return b && { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2, pointX: ${end === 'end' ? 'b.left' : 'b.right'}, pointY: b.top - 8 };
	})()`);
	if (!r) return null;
	const at = toScreen(r.x, r.y);
	const point = toScreen(r.pointX, r.pointY);
	return { x: at.x, y: at.y, pointX: point.x, pointY: point.y };
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
