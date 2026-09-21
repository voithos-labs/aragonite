// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRootGestures } from '$lib/components/editor-root-gestures';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createStickyColumnState } from '$lib/cursor/sticky-column';
import { createEdgeAffinityState } from '$lib/cursor/edge-affinity';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import { parse } from '$lib/core/parser';
import type { BlockComponent } from '$lib/block-component';
import type { PresentationMode } from '$lib/presentation-mode';

// Miss-analysis: the click test and the margin drag's setup were driven only through Playwright,
// so no jsdom test named a refusal (a widget that runs its own gesture, a modifier held down,
// reading mode) or the step that ends the previous range.

const BOX = { left: 40, right: 400, top: 20, bottom: 60 };
/** In the root's left margin, level with the block's first line. */
const MARGIN = { clientX: 10, clientY: 40 };

const teardowns: (() => void)[] = [];
const origFromPoint = document.elementFromPoint;

beforeEach(() => {
	document.body.replaceChildren();
});

afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
	document.elementFromPoint = origFromPoint;
});

function harness(opts: { mode?: PresentationMode } = {}) {
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
	const link = document.createElement('a');
	link.setAttribute('href', 'https://example.com/');
	const header = document.createElement('div');
	const headerLink = document.createElement('a');
	headerLink.setAttribute('href', 'https://host.example/');
	header.append(headerLink);
	list.append(host, editable, proxy, widget, link);
	root.append(header, list);
	document.body.append(root);
	// The margin resolves to the root; a point pulled into the box resolves to the block.
	document.elementFromPoint = ((x: number) =>
		x < BOX.left ? root : face) as typeof document.elementFromPoint;

	const mode = opts.mode ?? 'source';
	const selection = createSelectionState();
	const doc = parse('---\n\nafter\n');
	const refs = buildLinkReferenceMap(doc.children);
	const startDragAtPoint = vi.fn(() => true);
	const focus = vi.fn();
	const component = { focusable: true, focus, startDragAtPoint } as unknown as BlockComponent;
	const activateLink = vi.fn();
	const gestures = createRootGestures({
		get mode() {
			return mode;
		},
		getDoc: () => doc,
		selection,
		stickyColumn: createStickyColumnState(),
		edgeAffinity: createEdgeAffinityState(),
		getBlockElByPath: () => null,
		getBlockComponent: () => component,
		revealPath: async () => component,
		getScrollHost: () => root,
		getLifetime: () => new AbortController().signal,
		isHostChrome: (node) => !!node && header.contains(node),
		activateLink,
		linkCard: { open: () => false },
		linkRef: { current: refs.resolve, signature: refs.signature, epoch: 0 }
	});
	teardowns.push(gestures.install(root));

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
		link,
		headerLink,
		selection,
		gestures,
		startDragAtPoint,
		focus,
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

	it('a plain click on a link is suppressed without activating it', () => {
		const h = harness();
		expect(h.click(h.link).defaultPrevented).toBe(true);
		expect(h.activateLink).not.toHaveBeenCalled();
	});

	it.each<[string, MouseEventInit, PresentationMode]>([
		['a mod-click', { ctrlKey: true }, 'source'],
		['a plain click in reading mode', {}, 'reading']
	])('%s activates the link', (_label, init, mode) => {
		const h = harness({ mode });
		expect(h.click(h.link, init).defaultPrevented).toBe(true);
		expect(h.activateLink).toHaveBeenCalledWith('https://example.com/', expect.any(MouseEvent));
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
