// The iOS Simulator rows, keyed by the scenario each one runs in
// `src/lib/e2e/requirements/mobile/ios.md`; the probes are reported and judge nothing. Taps are
// native (`nativeWebTap`), keys are taps on the on-screen keyboard's `XCUIElementTypeKey`s.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { distinguishable, shape } from './judge.mjs';
import {
	BARE_HOST,
	BARE_TEXT,
	CARET_BOX,
	CLIPBOARD_BUTTONS,
	FENCE_CHIP,
	HIDE_PRESSES,
	INSTALL_LOG,
	PROBE_DOC,
	RANGE_END,
	READ_LOG,
	READ_STATE,
	REMOVE_FAR_BLOCK_MID_DRAG,
	bareBlock,
	blockOf,
	brief,
	caretColour,
	centreOf,
	collapseAt,
	drawHandle,
	save,
	timeline,
	wordBox,
	writes
} from './touch-probes.mjs';

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

// Whether the editor can take a long press's word over: Safari's last write, a transparent caret,
// whose handle gets the finger, the clipboard, one shared host. Each saves `<slug>.json`.
export const probes = {
	'1 collapse timing: no collapse, when Safari last writes': async (ctx) => {
		const outcome = await collapseTiming(ctx, 'p1-none', null);
		lastWriteAfterLift = outcome.timing.lastRangeAfterEnd;
		return outcome;
	},
	'1 collapse timing: at the first range under the finger': (ctx) =>
		collapseTiming(ctx, 'p1-first-range', { end: 'pointerup', moment: 'first range' }),
	'1 collapse timing: at the pointerup': (ctx) =>
		collapseTiming(ctx, 'p1-pointerup', { end: 'pointerup', moment: 'sync' }),
	'1 collapse timing: a microtask after the pointerup': (ctx) =>
		collapseTiming(ctx, 'p1-microtask', { end: 'pointerup', moment: 'microtask' }),
	'1 collapse timing: a task after the pointerup': (ctx) =>
		collapseTiming(ctx, 'p1-task', { end: 'pointerup', moment: 'task' }),
	'1 collapse timing: at the next range after the pointerup': (ctx) =>
		collapseTiming(ctx, 'p1-next-range', { end: 'pointerup', moment: 'next range' }),
	"1 collapse timing: once Safari's measured last write is past": (ctx) =>
		collapseTiming(ctx, 'p1-measured', {
			end: 'pointerup',
			moment: 'delay',
			ms: Math.max(0, lastWriteAfterLift ?? 200) + 100
		}),

	'2 caret colour: transparent on the block before the press': (ctx) =>
		caretColourProbe(ctx, 'p2-block-before', { on: blockOf(0), when: 'before' }),
	'2 caret colour: transparent on the editor root before the press': (ctx) =>
		caretColourProbe(ctx, 'p2-root-before', { on: '.editor', when: 'before' }),
	'2 caret colour: transparent at the touch press': (ctx) =>
		caretColourProbe(ctx, 'p2-block-press', { on: blockOf(0), when: 'press' }),
	'2 caret colour: transparent once the range stands': (ctx) =>
		caretColourProbe(ctx, 'p2-block-range', { on: blockOf(0), when: 'range' }),

	"3 who gets the finger: a handle below the end, Safari's hidden": (ctx) =>
		drawnHandle(ctx, 'p3-below-hidden', { place: 'below', hidden: true }),
	"3 who gets the finger: a handle on the end, Safari's hidden": (ctx) =>
		drawnHandle(ctx, 'p3-on-hidden', { place: 'on', hidden: true }),
	"3 who gets the finger: a handle right of the end, Safari's hidden": (ctx) =>
		drawnHandle(ctx, 'p3-right-hidden', { place: 'right', hidden: true }),
	"3 who gets the finger: a handle on the end, Safari's shown": (ctx) =>
		drawnHandle(ctx, 'p3-on-shown', { place: 'on', hidden: false }),

	'4 clipboard: the page writes and reads, Safari pastes into a textarea': (ctx) =>
		pageClipboard(ctx, 'p4-page'),
	"4 clipboard: readText of another app's copy": (ctx) => readTextPrompt(ctx, 'p4-read-text'),
	"4 clipboard: Safari's paste on the caret beside a painted range": (ctx) =>
		caretPaste(ctx, 'p4-caret-paste', { hidden: false }),
	"4 clipboard: Safari's paste on that caret, the taps kept from the editor": (ctx) =>
		caretPaste(ctx, 'p4-caret-paste-hidden', { hidden: true }),

	"7 a shared host: Safari's handle from the first block into the third": (ctx) =>
		sharedHost(ctx, 'p7-across', { into: 'third' }),
	'7 a shared host: a far block removed mid-drag': (ctx) =>
		sharedHost(ctx, 'p7-far-removed', { into: 'third', removeFar: true }),
	"7 a shared host: Safari's handle into a chip": (ctx) =>
		sharedHost(ctx, 'p7-chip', { into: 'chip' }),
	"7 a shared host: Safari's handle into a chip, fenced": (ctx) =>
		sharedHost(ctx, 'p7-chip-fenced', { into: 'chip', fence: true }),
	"7 a shared host: Safari's handle into a caption": (ctx) =>
		sharedHost(ctx, 'p7-caption', { into: 'caption' })
};

// What the first timing probe measured, for the last one to wait out.
let lastWriteAfterLift = null;

async function collapseTiming(ctx, slug, collapse) {
	await ctx.fresh(ctx.url, PROBE_DOC);
	await page(ctx, INSTALL_LOG);
	if (collapse) await page(ctx, collapseAt(collapse));
	const pressed = await holdWord(ctx, blockOf(0), 'two', await mapBlock(ctx, 0));
	await sleep(500);
	const soon = await look(ctx, `${slug}-500ms`);
	await sleep(1000);
	const later = await look(ctx, `${slug}-1500ms`);
	const log = await page(ctx, READ_LOG);
	const timing = writes(log, 'pointerup');
	const file = save(ctx.out, slug, {
		collapse,
		pressed,
		timing,
		soon,
		later,
		timeline: timeline(log),
		log
	});
	return { file, collapse, timing, soon: brief(soon), later: brief(later) };
}

// `when`: before the press, at the touch press, or once the long press's range stands. Then the
// colour goes back, and a tap shows whether the caret is visible again.
async function caretColourProbe(ctx, slug, { on, when }) {
	await ctx.fresh(ctx.url, PROBE_DOC);
	await page(ctx, INSTALL_LOG);
	const at = await mapBlock(ctx, 0);
	if (when !== 'range')
		await page(ctx, caretColour(on, 'transparent', { atPress: when === 'press' }));
	const pressed = await holdWord(ctx, blockOf(0), 'two', at);
	await sleep(600);
	const end = await page(ctx, RANGE_END);
	const steps = { range: await look(ctx, `${slug}-range`) };
	if (when === 'range') {
		await page(ctx, caretColour(on, 'transparent'));
		await sleep(600);
		steps.hiddenOnTheRange = await look(ctx, `${slug}-hidden`);
	} else {
		await page(ctx, caretColour(on, ''));
		await sleep(600);
		steps.restoredOnTheRange = await look(ctx, `${slug}-restored`);
		// A tap past the end of the first block's line leaves the caret there; three shots span a blink.
		await ctx.click(await ctx.editable(0));
		for (const n of [1, 2, 3]) {
			await sleep(350);
			await ctx.screenshot(`${slug}-caret-${n}`).catch(() => {});
		}
		steps.caret = await look(ctx, `${slug}-caret`);
	}
	const log = await page(ctx, READ_LOG);
	const rangeEnd = end && { page: end, native: at(end.x, end.y) };
	const file = save(ctx.out, slug, {
		on,
		when,
		pressed,
		rangeEnd,
		steps,
		timeline: timeline(log),
		log
	});
	const briefs = Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, brief(v)]));
	return { file, rangeEndNative: rangeEnd?.native ?? null, ...briefs };
}

// A long press on a word mid-block, a stand-in handle at its end, then a drag from that handle
// into the next block. The stand-in writes the block's first three characters when it moves.
async function drawnHandle(ctx, slug, { place, hidden }) {
	await ctx.fresh(ctx.url, PROBE_DOC);
	await page(ctx, INSTALL_LOG);
	const at = await mapBlock(ctx, 0);
	if (hidden) await page(ctx, caretColour(blockOf(0), 'transparent'));
	const pressed = await holdWord(ctx, blockOf(0), 'two', at);
	await sleep(800);
	const drawn = await page(ctx, drawHandle(place, blockOf(0)));
	const before = await look(ctx, `${slug}-drawn`);
	if (!drawn) {
		const file = save(ctx.out, slug, { place, hidden, pressed, before });
		return {
			file,
			error: 'the long press left no range to draw a handle on',
			before: brief(before)
		};
	}
	const target = await page(ctx, wordBox(blockOf(1), 'six'));
	const from = at(drawn.box.left + 22, drawn.box.top + 22);
	const to = at(target.x, target.y);
	const dragAt = await now(ctx);
	await drag(ctx, from, to);
	await sleep(1000);
	const after = await look(ctx, `${slug}-after`);
	const dragLog = (await page(ctx, READ_LOG)).filter((r) => r.at >= dragAt);
	const ours = dragLog.some((r) => r.what === 'handle pressed');
	const text = after.native?.text ?? null;
	const verdict =
		ours && text === 'one'
			? 'the drawn handle took the finger'
			: !ours && text !== before.native?.text
				? "Safari's handle took the finger"
				: 'neither moved the range as expected';
	const file = save(ctx.out, slug, {
		place,
		hidden,
		pressed,
		drawn,
		from,
		to,
		before,
		after,
		drag: dragLog
	});
	return {
		file,
		verdict,
		pageSawThePress: ours,
		events: timeline(dragLog).slice(0, 16),
		before: brief(before),
		after: brief(after)
	};
}

// The page's own write and read, from its buttons, then Safari's Paste into a plain textarea.
async function pageClipboard(ctx, slug) {
	await ctx.fresh(ctx.url, SHORT);
	await page(ctx, INSTALL_LOG);
	await page(ctx, CLIPBOARD_BUTTONS);
	const tap = async (id) => ctx.click(await ctx.find('css selector', `#${id}`));
	const seeded = await setPasteboard(ctx, 'before the write');
	await tap('probe-write');
	await sleep(1000);
	const pasteboard = await mobile(ctx, 'getPasteboard', { encoding: 'utf8' }).catch(
		(error) => `unread: ${String(error).slice(0, 200)}`
	);
	await tap('probe-read');
	await sleep(700);
	const read = await look(ctx, `${slug}-read`);
	await sleep(800);
	// One tap focuses the textarea; a second on its caret opens Safari's menu.
	await tap('probe-area');
	await sleep(1000);
	await tap('probe-area');
	await sleep(1000);
	const areaMenu = await look(ctx, `${slug}-area-menu`);
	const pasted = await tapNativeMenu(ctx, 'Paste');
	await sleep(1000);
	const area = await page(ctx, `document.getElementById('probe-area').value`);
	const log = await page(ctx, READ_LOG);
	const file = save(ctx.out, slug, {
		pasteboard,
		read,
		areaMenu,
		pasted,
		area,
		timeline: timeline(log),
		log
	});
	return {
		file,
		seeded,
		pasteboardAfterWrite: pasteboard,
		menuOnRead: brief(read).menu,
		menuOnTheArea: brief(areaMenu).menu,
		pastedIntoTheArea: pasted,
		area,
		calls: timeline(log.filter((r) => r.what))
	};
}

// readText with the pasteboard set from outside the page, as another app's copy: Safari's Paste
// tapped at once, tapped a second after it shows, and dismissed by a tap elsewhere.
async function readTextPrompt(ctx, slug) {
	await ctx.fresh(ctx.url, SHORT);
	await page(ctx, INSTALL_LOG);
	await page(ctx, CLIPBOARD_BUTTONS);
	const attempts = [];
	for (const how of ['at once', 'after a second', 'dismissed']) {
		const seeded = await setPasteboard(ctx, `other app words, ${how}`);
		const from = await now(ctx);
		await ctx.click(await ctx.find('css selector', '#probe-read-text'));
		const shownAfterMs = await waitForNativeMenu(ctx, 'Paste', 4000);
		await ctx.screenshot(`${slug}-${how.replace(/ /g, '-')}`).catch(() => {});
		const taps = [];
		if (how === 'dismissed') await ctx.click(await ctx.editable(2));
		else {
			if (how === 'after a second') await sleep(1200);
			taps.push(await tapNativeMenu(ctx, 'Paste'));
			await sleep(800);
			const settled = (await page(ctx, READ_LOG)).some(
				(r) => r.at >= from && /probe-read-text (resolved|rejected)/.test(r.what ?? '')
			);
			if (!settled) {
				await sleep(600);
				taps.push(await tapNativeMenu(ctx, 'Paste'));
			}
		}
		await sleep(1000);
		const log = await page(ctx, READ_LOG);
		attempts.push({
			how,
			seeded,
			shownAfterMs,
			tappedPaste: taps,
			calls: timeline(log.filter((r) => r.at >= from && r.what))
		});
	}
	const log = await page(ctx, READ_LOG);
	const file = save(ctx.out, slug, { attempts, timeline: timeline(log), log });
	return { file, attempts };
}

// A range across two blocks leaves a collapsed native caret; a tap on it, then Safari's own Paste.
// `hidden` keeps the taps from the editor, whose tap rule would clear the range.
async function caretPaste(ctx, slug, { hidden }) {
	await ctx.fresh(ctx.url, SHORT);
	await page(ctx, INSTALL_LOG);
	const seeded = await setPasteboard(ctx, 'pasted words');
	await ctx.click(await ctx.editable(1));
	await sleep(800);
	await ctx.run(`window.__test.setSelection(${JSON.stringify(RANGE)}); return true`);
	await sleep(800);
	const painted = await look(ctx, `${slug}-painted`);
	const caret = await page(ctx, CARET_BOX);
	if (!caret) {
		const file = save(ctx.out, slug, { hidden, seeded, painted });
		return { file, error: 'no caret box beside the painted range', painted: brief(painted) };
	}
	if (hidden) await page(ctx, HIDE_PRESSES);
	const index = JSON.parse(painted.native?.focus?.[0] ?? '[1]')[0];
	const point = (await mapBlock(ctx, index))(caret.x, caret.y);
	const taps = [];
	for (let n = 1; n <= 2 && !taps.some((t) => t.menu?.includes('Paste')); n++) {
		await mobile(ctx, 'tap', point);
		await sleep(900);
		taps.push(brief(await look(ctx, `${slug}-tap-${n}`)));
	}
	const pasted = await tapNativeMenu(ctx, 'Paste');
	await sleep(1200);
	const after = await look(ctx, `${slug}-after`);
	const text = await ctx.source();
	const log = await page(ctx, READ_LOG);
	const file = save(ctx.out, slug, {
		hidden,
		painted,
		caret,
		point,
		taps,
		pasted,
		after,
		text,
		timeline: timeline(log),
		log
	});
	return {
		file,
		seeded,
		painted: brief(painted),
		taps,
		pastedFromSafari: pasted,
		pasteEvents: log.filter((r) => r.type === 'paste'),
		replacedTheRange: text === `${SHORT.slice(0, 2)}pasted words${SHORT.slice(17)}`,
		source: text,
		after: brief(after)
	};
}

// One editing host over plain blocks: a long press, then Safari's end handle dragged into the third
// block, a chip or a caption; a scroll follows a widget, since a drag that never ended moves again.
async function sharedHost(ctx, slug, { into, removeFar = false, fence = false }) {
	await ctx.fresh(ctx.url, SHORT);
	// Mapped on the editor's page, since the bare page has no block for the lookup; a viewport
	// point maps to the screen the same way on both.
	const at = await mapBlock(ctx, 0);
	await page(ctx, BARE_HOST);
	await sleep(1000);
	await page(ctx, INSTALL_LOG);
	if (removeFar) await page(ctx, REMOVE_FAR_BLOCK_MID_DRAG);
	if (fence) await page(ctx, FENCE_CHIP);
	const [block, word] = { third: [0, 'alpha'], chip: [3, 'kappa'], caption: [4, 'nu'] }[into];
	const pressed = await holdWord(ctx, bareBlock(block), word, at);
	await sleep(800);
	const press = await look(ctx, `${slug}-press`);
	const end = await page(ctx, RANGE_END);
	const target = await page(
		ctx,
		into === 'third'
			? wordBox(bareBlock(2), 'epsilon')
			: centreOf(into === 'chip' ? '.chip' : '.caption')
	);
	if (!end || !target) {
		const file = save(ctx.out, slug, { into, pressed, press, end, target });
		return { file, error: 'no range end or no target after the long press', press: brief(press) };
	}
	// Safari hangs the end handle's knob below the range's last line.
	const from = at(end.right, end.bottom + 6);
	const to = at(target.x, target.y);
	const dragAt = await now(ctx);
	await drag(ctx, from, to);
	await sleep(1200);
	const dragged = await look(ctx, `${slug}-dragged`);
	let scrolled = null;
	if (into !== 'third') {
		const scrollAt = await now(ctx);
		await mobile(ctx, 'swipe', { direction: 'up' });
		await sleep(1200);
		scrolled = await look(ctx, `${slug}-scrolled`);
		scrolled.changesOnScroll = (await page(ctx, READ_LOG)).filter(
			(r) => r.type === 'selectionchange' && r.at >= scrollAt
		).length;
	}
	const blocks = await page(ctx, BARE_TEXT);
	const log = await page(ctx, READ_LOG);
	const file = save(ctx.out, slug, {
		into,
		removeFar,
		fence,
		pressed,
		press,
		from,
		to,
		dragged,
		scrolled,
		blocks,
		timeline: timeline(log),
		log
	});
	return {
		file,
		press: brief(press),
		dragged: brief(dragged),
		scrolled: scrolled && { ...brief(scrolled), changesOnScroll: scrolled.changesOnScroll },
		dragEvents: timeline(log.filter((r) => r.at >= dragAt)).slice(0, 24)
	};
}

// ── Probe steps ──────────────────────────

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const page = (ctx, expression) => ctx.run(`return ${expression}`);
const now = (ctx) => page(ctx, 'window.__probe.now()');

async function mapBlock(ctx, index) {
	const at = await webToNative(ctx, index);
	if (!at) throw new Error(`no native element for block ${index}`);
	return at;
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

// The Simulator's pasteboard, set from outside the page as another app's copy would set it.
const setPasteboard = (ctx, content) =>
	mobile(ctx, 'setPasteboard', { content, encoding: 'utf8' }).then(
		() => 'set',
		(error) => `unset: ${String(error).slice(0, 200)}`
	);

const drag = (ctx, from, to) =>
	mobile(ctx, 'dragFromToForDuration', {
		duration: 0.3,
		fromX: from.x,
		fromY: from.y,
		toX: to.x,
		toY: to.y
	});

// A finger held 1.5 s on `word` under `selector`, then lifted.
async function holdWord(ctx, selector, word, at) {
	const box = await page(ctx, wordBox(selector, word));
	if (!box) throw new Error(`no "${word}" under ${selector}`);
	const point = at(box.x, box.y);
	await mobile(ctx, 'touchAndHold', { ...point, duration: 1.5 });
	return { box, point };
}

// A moment after a gesture: a screenshot, the page's state, Safari's edit menu and the keyboard.
async function look(ctx, name) {
	const shotAt = await now(ctx).catch(() => null);
	await ctx.screenshot(name).catch(() => {});
	const state = await page(ctx, READ_STATE);
	return { shot: `${name}.png`, shotAt, ...state, ...(await nativeLook(ctx)) };
}

const MENU_LABELS = [
	'Cut',
	'Copy',
	'Paste',
	'Select',
	'Select All',
	'Look Up',
	'Translate',
	'Share…',
	'Find Selection',
	'Format',
	'AutoFill',
	'Writing Tools',
	'Search Web',
	'Replace…',
	'Speak'
];
const menuItem = (label) =>
	`label == '${label}' AND (type == 'XCUIElementTypeMenuItem' OR type == 'XCUIElementTypeButton')`;

// Safari's edit menu (its menu items, or buttons named for an edit command) and whether the
// keyboard is up, from one visit to the native context.
async function nativeLook(ctx) {
	await ctx.native();
	const labels = MENU_LABELS.map((label) => `'${label}'`).join(', ');
	const found = await ctx
		.call('POST', ctx.s('/elements'), {
			using: '-ios predicate string',
			value: `type == 'XCUIElementTypeMenuItem' OR (type == 'XCUIElementTypeButton' AND label IN {${labels}})`
		})
		.catch(() => []);
	const menu = [];
	for (const el of found.slice(0, 16)) {
		const id = el[ELEMENT];
		const read = (route) => ctx.call('GET', ctx.s(`/element/${id}/${route}`)).catch(() => null);
		menu.push({ label: await read('attribute/label'), type: await read('name') });
	}
	const keyboard = !!(await ctx.tryFind('-ios class chain', '**/XCUIElementTypeKeyboard'));
	await ctx.web();
	return { menu, keyboard };
}

async function tapNativeMenu(ctx, label) {
	await ctx.native();
	const id = await ctx.tryFind('-ios predicate string', menuItem(label));
	if (id) await ctx.click(id);
	await ctx.web();
	return !!id;
}

// How long Safari's menu item `label` took to show, polled up to `ms`, or null.
async function waitForNativeMenu(ctx, label, ms) {
	const started = Date.now();
	await ctx.native();
	let id = null;
	while (!id && Date.now() - started < ms)
		id = await ctx.tryFind('-ios predicate string', menuItem(label));
	await ctx.web();
	return id ? Date.now() - started : null;
}

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
