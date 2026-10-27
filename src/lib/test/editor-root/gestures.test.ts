// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRootGestures } from '#lib/components/editor-root/gestures.js';
import { installPressTracker } from '#lib/components/editor-root/listeners.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { definitionsOf } from '#lib/core/inline/scan/definitions.js';
import { parse } from '#lib/core/parser.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '../harness/fixture-grammar';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import { asEditorX } from '#lib/core/coordinate-spaces.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';
import { bindActivationClick, createPressTracker, type LinkClick } from '#lib/activation-click.js';
import { ACTIVATION_CLICK_CASES } from '#lib/test/harness/activation-click-cases.js';
import { registerInlineSyntax } from '#lib/plugin.js';
import { registerInlineWidgetKind } from '#lib/core/inline/inline-widgets.js';
import { declarePluginInlineKind } from '#lib/schema/plugin-kind.js';
import { marksPending, pendMark } from '#lib/test/harness/pending-marks.js';

// Miss-analysis: the click and margin drag were driven only through Playwright, never a refusal.

const BOX = { left: 40, right: 400, top: 20, bottom: 60 };
/** Where the link blocks sit, out of reach of every margin row. */
const FAR_BELOW = { left: 40, right: 400, top: 1000, bottom: 1040 };
/** In the root's left margin, level with the block's first line. */
const MARGIN = { clientX: 10, clientY: 40 };
/** The text of the block a margin click resolves to, which a click run there selects. */
const NEAREST_TEXT = 'nearest block text';

// A plugin widget, `%%w%%`, that goes somewhere on a click and draws its own anchor to do it.
function registerAnchorWidget(): void {
	const kind = declarePluginInlineKind('gestureAnchorWidget');
	registerInlineSyntax('%', (raw, pos, end) => {
		if (!raw.startsWith('%%', pos)) return null;
		const close = raw.indexOf('%%', pos + 2);
		if (close < 0 || close + 2 > end) return null;
		return { kind, start: pos, end: close + 2, children: [] };
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		view: () => ({}),
		editing: { revealSource: true, claimsActivationClick: true }
	});
}

const teardowns: (() => void)[] = [];
const origFromPoint = document.elementFromPoint;

beforeEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
	document.elementFromPoint = origFromPoint;
});

function harness(opts: { mode?: PresentationMode; linkClick?: LinkClick } = {}) {
	const root = document.createElement('div');
	const list = document.createElement('div');
	list.className = 'block-list';
	// A rendered block with no text to click into (a rule, a closed equation): the margin
	// drag starts from it as a whole block, which needs no caret at the point.
	const host = document.createElement('div');
	host.setAttribute('data-block-path', '[0]');
	host.getBoundingClientRect = () => BOX as DOMRect;
	const face = document.createElement('div');
	host.append(face);
	const editable = document.createElement('div');
	editable.setAttribute('contenteditable', 'true');
	editable.tabIndex = 0;
	const proxy = document.createElement('div');
	proxy.setAttribute('contenteditable', 'true');
	proxy.setAttribute('data-whole-block-input', '');
	const widget = document.createElement('div');
	widget.setAttribute('data-pointer-gesture', '');
	// What the path lookup answers with: the block a click outside every editable resolves to,
	// whose own editable child is where a click run there selects.
	const nearest = document.createElement('div');
	// The same box as the rendered block, so a test that gives this one a block path of its own
	// does not move the band the margin click resolves against.
	nearest.getBoundingClientRect = () => BOX as DOMRect;
	const nearestText = document.createElement('div');
	nearestText.setAttribute('contenteditable', 'true');
	nearestText.textContent = NEAREST_TEXT;
	nearest.append(nearestText);
	// A Markdown link as the render draws it, so the DOM text is the block's raw.
	const link = document.createElement('a');
	link.setAttribute('href', 'https://example.com/');
	link.textContent = 'link';
	const linkText = document.createElement('div');
	linkText.append('a [', link, '](https://example.com/) b');
	const linkHost = document.createElement('div');
	linkHost.setAttribute('data-block-path', '[2]');
	linkHost.getBoundingClientRect = () => FAR_BELOW as DOMRect;
	linkHost.append(linkText);
	// An anchor over plain words, which no construct a click follows draws.
	const strayLink = document.createElement('a');
	strayLink.setAttribute('href', 'https://stray.example/');
	strayLink.textContent = 'words';
	const strayText = document.createElement('div');
	strayText.append('plain ', strayLink, ' here');
	const strayHost = document.createElement('div');
	strayHost.setAttribute('data-block-path', '[3]');
	strayHost.getBoundingClientRect = () => FAR_BELOW as DOMRect;
	strayHost.append(strayText);
	// The widget's shell over `%%w%%` (2..7), holding the anchor the widget draws itself.
	const widgetLink = document.createElement('a');
	widgetLink.setAttribute('href', 'https://widget.example/');
	widgetLink.textContent = 'w';
	const widgetShell = document.createElement('span');
	widgetShell.setAttribute('data-inline-widget', '');
	widgetShell.setAttribute('data-source-start', '2');
	widgetShell.setAttribute('data-source-end', '7');
	widgetShell.append(widgetLink);
	const widgetText = document.createElement('div');
	widgetText.append('x ', widgetShell, ' y');
	const widgetHost = document.createElement('div');
	widgetHost.setAttribute('data-block-path', '[4]');
	widgetHost.getBoundingClientRect = () => FAR_BELOW as DOMRect;
	widgetHost.append(widgetText);
	const header = document.createElement('div');
	const headerLink = document.createElement('a');
	headerLink.setAttribute('href', 'https://host.example/');
	header.append(headerLink);
	list.append(host, editable, proxy, widget, linkHost, strayHost, widgetHost, nearest);
	root.append(header, list);
	document.body.append(root);
	// The margin resolves to the root; a point pulled into the box resolves to the block.
	document.elementFromPoint = ((x: number) =>
		x < BOX.left ? root : face) as typeof document.elementFromPoint;

	const mode = opts.mode ?? 'source';
	const selection = createSelectionState();
	const doc = parse(
		'---\n\nafter\n\na [link](https://example.com/) b\n\nplain words here\n\nx %%w%% y\n'
	);
	const refs = definitionsOf(doc.children);
	const startDragAtPoint = vi.fn(() => true);
	const focus = vi.fn();
	const readSnapAtPoint = vi.fn(() => () => {});
	const component = {
		focusable: true,
		focus,
		startDragAtPoint,
		readSnapAtPoint
	} as unknown as BlockComponent;
	const activateLink = vi.fn();
	const caretMemory = createCaretMemory();
	const reading = fixtureReading(
		{ resolver: refs.resolve, resolverSignature: refs.signature, resolverEpoch: 0 },
		mode
	);
	const linkClick = opts.linkClick ?? 'modifier';
	const presses = createPressTracker();
	const gestures = createRootGestures({
		caretWriter: testCaretWriter,
		getDoc: () => doc,
		selection,
		caretMemory,
		getBlockElByPath: (path) => [linkText, strayText, widgetText][path[0] - 2] ?? nearest,
		getBlockComponent: () => component,
		land: async () => 'placed',
		getScrollHost: () => root,
		getLifetime: () => new AbortController().signal,
		isHostChrome: (node) => !!node && header.contains(node),
		activateLink,
		linkCard: { open: () => false },
		reading,
		// Reading mode's click caret is `reading-focus.test.ts`'s.
		readingFocus: { noteClick: () => {} },
		activationClick: bindActivationClick(reading.mode, () => linkClick, presses),
		presses
	});
	teardowns.push(installPressTracker(root, presses), gestures.install(root));

	const withRange = () =>
		selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 2 });
	const fire = (type: string, target: EventTarget, init: MouseEventInit = {}) => {
		const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...MARGIN, ...init });
		target.dispatchEvent(event);
		return event;
	};
	return {
		root,
		editable,
		proxy,
		widget,
		nearest,
		link,
		strayLink,
		widgetLink,
		headerLink,
		selection,
		caretMemory,
		gestures,
		startDragAtPoint,
		focus,
		readSnapAtPoint,
		activateLink,
		withRange,
		press: (target: EventTarget, init?: MouseEventInit) => fire('pointerdown', target, init),
		mouseDown: (target: EventTarget, init?: MouseEventInit) => fire('mousedown', target, init),
		click: (target: EventTarget, init?: MouseEventInit) => fire('click', target, init)
	};
}

describe('editor-root gestures: the margin drag', () => {
	it('a dead-space press ends a live range, branches the drag and suppresses the native one', () => {
		const h = harness();
		h.withRange();
		h.press(h.root);
		expect(h.selection.isCrossBlock).toBe(false);
		expect(h.startDragAtPoint).toHaveBeenCalledWith(10, 40, expect.any(MouseEvent));
		expect(h.mouseDown(h.root).defaultPrevented).toBe(true);
	});

	// A click moves the caret without a key, so the column, the side and the marks go together:
	// a side left behind would steer the next typed byte by an arrival the click replaced.
	it('a dead-space press forgets how the caret arrived', () => {
		const h = harness();
		h.caretMemory.noteKey({ key: 'ArrowDown' }, null, () => asEditorX(120));
		pendMark(h.caretMemory);
		h.press(h.root);
		expect(h.caretMemory.column()).toBeNull();
		expect(h.caretMemory.side()).toBeNull();
		expect(marksPending(h.caretMemory)).toBe(false);
	});

	it.each<[string, MouseEventInit]>([
		['a shift press', { shiftKey: true }],
		['a mod press', { ctrlKey: true }],
		['a secondary button', { button: 2 }]
	])('%s declines', (_label, init) => {
		const h = harness();
		h.withRange();
		h.press(h.root, init);
		expect(h.selection.isCrossBlock).toBe(true);
		expect(h.mouseDown(h.root, init).defaultPrevented).toBe(false);
	});

	it('reading mode declines', () => {
		const h = harness({ mode: 'reading' });
		h.withRange();
		h.press(h.root);
		expect(h.selection.isCrossBlock).toBe(true);
	});

	it("a press inside a widget's own gesture surface declines", () => {
		const h = harness();
		h.withRange();
		h.press(h.widget);
		expect(h.selection.isCrossBlock).toBe(true);
	});

	it('a press on an editable surface declines; a whole-block input proxy does not', () => {
		const h = harness();
		h.withRange();
		h.press(h.editable);
		expect(h.selection.isCrossBlock).toBe(true);
		h.press(h.proxy);
		expect(h.selection.isCrossBlock).toBe(false);
	});

	it('the second press of a click run hands the gesture to the priority order', () => {
		const h = harness();
		h.press(h.root);
		expect(h.mouseDown(h.root, { detail: 2 }).defaultPrevented).toBe(false);
	});

	// Miss-analysis: only the margin drag's press was tested, not where a dead-space click lands.
	it('a click run on dead space selects in the nearest block; a plain press does not', () => {
		const h = harness();
		expect(h.mouseDown(h.root, { detail: 3 }).defaultPrevented).toBe(true);
		expect(window.getSelection()?.toString()).toBe(NEAREST_TEXT);

		window.getSelection()?.removeAllRanges();
		h.press(h.root);
		expect(h.mouseDown(h.root).defaultPrevented).toBe(true);
		expect(window.getSelection()?.toString()).toBe('');
	});

	// Miss-analysis: no test gave the landing element a block path a plugin, not a host, wrote.
	it('a click run still lands where the surface carries a foreign block path', () => {
		const h = harness();
		h.nearest.setAttribute('data-block-path', 'not-json');
		expect(h.mouseDown(h.root, { detail: 3 }).defaultPrevented).toBe(true);
		expect(window.getSelection()?.toString()).toBe(NEAREST_TEXT);
	});

	it('a click run on a surface the drag declines selects nothing', () => {
		const h = harness();
		expect(h.mouseDown(h.widget, { detail: 3 }).defaultPrevented).toBe(false);
		expect(window.getSelection()?.toString()).toBe('');
	});
});

describe('editor-root gestures: the click priority order', () => {
	it('a margin click that did not move leaves what was being edited', () => {
		const h = harness();
		h.editable.focus();
		h.press(h.root);
		h.mouseDown(h.root);
		h.click(h.root);
		expect(document.activeElement).not.toBe(h.editable);
	});

	it('a margin release past the drag slop is no click', () => {
		const h = harness();
		h.editable.focus();
		h.press(h.root);
		h.mouseDown(h.root);
		h.click(h.root, { clientX: MARGIN.clientX + 10 });
		expect(document.activeElement).toBe(h.editable);
	});

	for (const { name, linkClick, mode, modified, detail, follows } of ACTIVATION_CLICK_CASES) {
		it(`a link click, ${name}, ${follows ? 'follows' : 'stays put'}`, () => {
			const h = harness({ mode, linkClick });
			expect(h.click(h.link, { ctrlKey: modified, detail }).defaultPrevented).toBe(true);
			const followed = [['https://example.com/', expect.any(MouseEvent)]];
			expect(h.activateLink.mock.calls).toEqual(follows ? followed : []);
		});
	}

	it('an anchor no followed construct draws follows nothing, even in reading mode', () => {
		const h = harness({ mode: 'reading' });
		expect(h.click(h.strayLink).defaultPrevented).toBe(true);
		expect(h.activateLink).not.toHaveBeenCalled();
	});

	// Edit link shows a claiming widget's source, so its own anchor is something a click follows.
	it('an anchor a widget that claims the click draws follows', () => {
		registerAnchorWidget();
		const h = harness();
		expect(h.click(h.widgetLink, { ctrlKey: true }).defaultPrevented).toBe(true);
		expect(h.activateLink.mock.calls).toEqual([
			['https://widget.example/', expect.any(MouseEvent)]
		]);
	});

	it("host chrome keeps the page's own link behaviour", () => {
		const h = harness();
		expect(h.click(h.headerLink, { ctrlKey: true }).defaultPrevented).toBe(false);
		expect(h.activateLink).not.toHaveBeenCalled();
	});

	it('placeCaretAtPoint lands through the dead-space walk', () => {
		const h = harness();
		h.withRange();
		expect(h.gestures.placeCaretAtPoint(h.root, BOX.left + 5, 40)).toBe(true);
		expect(h.focus).toHaveBeenCalledOnce();
		expect(h.selection.isCrossBlock).toBe(false);
	});
});

// Miss-analysis: the readers were tested against a stubbed record, so nothing pinned which presses
// write it or what clears it.
describe('editor-root gestures: the right-click press record', () => {
	/** A press made on no range, after which the browser selects text under the pointer. */
	function pressThenSelect(init: MouseEventInit) {
		const h = harness();
		h.mouseDown(h.editable, init);
		const range = document.createRange();
		range.selectNodeContents(h.nearest.firstElementChild!);
		window.getSelection()!.addRange(range);
		return h;
	}

	it.each([
		['the right button', { button: 2 }],
		['Control with the primary button', { button: 0, ctrlKey: true }]
	])('%s records that the press landed on no range', (_, init) => {
		const h = pressThenSelect(init);
		expect(h.gestures.rangeAtContextPress(h.root)).toBe(false);
	});

	it.each([
		['a plain primary press', (h: ReturnType<typeof harness>) => h.mouseDown(h.editable)],
		[
			'a key',
			(h: ReturnType<typeof harness>) =>
				h.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }))
		],
		// A touch's long-press opens its menu with no mousedown before it.
		['a touch press', (h: ReturnType<typeof harness>) => h.press(h.editable)]
	])('%s after it hands the next menu to the live selection', (_, after) => {
		const h = pressThenSelect({ button: 2 });
		after(h);
		expect(h.gestures.rangeAtContextPress(h.root)).toBe(true);
	});
	// Miss-analysis: #756, the rows modelled Safari selecting a word or a block, never a widget.
	describe('a press on an inline widget', () => {
		/** Over the nearest block's box, where the caret walk lands. */
		const AT = { clientX: BOX.left + 5, clientY: 40 };

		function rightClick(h: ReturnType<typeof harness>, target: EventTarget, init = {}) {
			h.mouseDown(target, { ...AT, ...init });
			// Safari's own select of the element under the press.
			const range = document.createRange();
			range.selectNode(h.widgetLink.parentElement!);
			window.getSelection()!.addRange(range);
			target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...AT, ...init }));
		}

		it.each([
			['the right button', { button: 2 }],
			['Control with the primary button', { button: 0, ctrlKey: true }]
		])('with %s puts the caret at the press for the menu', (_, init) => {
			const h = harness();
			rightClick(h, h.widgetLink, init);
			expect(h.focus).toHaveBeenCalledOnce();
		});

		it('whose pointerdown a block cancelled, so no mousedown came, still puts the caret there', () => {
			const h = harness();
			h.press(h.widgetLink, { ...AT, button: 2 });
			h.widgetLink.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...AT }));
			expect(h.focus).toHaveBeenCalledOnce();
		});

		it('is read once, at its pointerdown, for the menu its mousedown and contextmenu follow', () => {
			const h = harness();
			h.press(h.widgetLink, { ...AT, button: 2 });
			h.mouseDown(h.widgetLink, { ...AT, button: 2 });
			h.widgetLink.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...AT }));
			expect(h.readSnapAtPoint).toHaveBeenCalledOnce();
			expect(h.focus).toHaveBeenCalledOnce();
		});

		it('on the widget the editor holds selected keeps it for the clipboard rows', () => {
			const h = harness();
			h.selection.selectWidget({ paragraphPath: [4], sourceStart: 2, preSelectOffset: 2 });
			rightClick(h, h.widgetLink, { button: 2 });
			expect(h.focus).not.toHaveBeenCalled();
			expect(h.gestures.rangeAtContextPress(h.root)).toBe(true);
		});

		it('on text leaves what the browser selected for the clipboard rows', () => {
			const h = harness();
			rightClick(h, h.editable, { button: 2 });
			expect(h.focus).not.toHaveBeenCalled();
		});

		it("inside the user's range keeps the range", () => {
			const h = harness();
			const range = document.createRange();
			range.selectNodeContents(h.widgetLink);
			window.getSelection()!.addRange(range);
			// jsdom draws no rectangles, so the range covers the press by fiat.
			Range.prototype.getClientRects = () =>
				[{ left: 0, right: 500, top: 0, bottom: 100 }] as never;
			teardowns.push(() => delete (Range.prototype as Partial<Range>).getClientRects);
			rightClick(h, h.widgetLink, { button: 2 });
			expect(h.focus).not.toHaveBeenCalled();
		});

		it('in reading mode places nothing', () => {
			const h = harness({ mode: 'reading' });
			rightClick(h, h.widgetLink, { button: 2 });
			expect(h.focus).not.toHaveBeenCalled();
		});

		it('from the keyboard places nothing', () => {
			const h = harness();
			h.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));
			h.widgetLink.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...AT }));
			expect(h.focus).not.toHaveBeenCalled();
		});
	});
});
