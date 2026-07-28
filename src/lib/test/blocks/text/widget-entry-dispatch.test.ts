// @vitest-environment jsdom
//
// Caret-entry against a widget edge dispatches on the widget kind's revealSource
// policy at TWO seams — the within-block caret-edge dispatch (`edge-policy-dispatch`,
// all four entry keys) and the cross-block `enterEdgeWidget`. Reveal-capable kinds
// (inline math) open the source reveal at the direction-appropriate edge; non-reveal
// kinds (image) keep select-then-step. This pins the split at both seams so a
// regression to N−1-of-N sibling parity fails here, not only in e2e.
import { beforeEach, describe, it, expect } from 'vitest';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { augmentInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { imageWidgetOnSelectedKey } from '$lib/components/image/image-widget-editing';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { domTextOffsetAtNode } from '$lib/cursor/widget-offset';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import type { AnyInlineKind, CstNode, InlineNode } from '$lib/core/nodes';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { stampMathWidget, installMathInline, widgetInteractionDeps } from './math-widget-fixture';

installMathInline();

beforeEach(() => {
	augmentInlineWidgetKind('image', { onSelectedKey: imageWidgetOnSelectedKey });
});

// Mount a paragraph with one atomic widget island between two prose text nodes —
// the shape TextEditableBlock renders. `widgetKind` selects the inline node the
// stamped island stands in for.
function mount(source: string, widgetKind: string) {
	const node: CstNode = parse(source).children[0];
	const widget = computeInlineContent(node).find((n: InlineNode) => n.kind === widgetKind)!;

	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(
		document.createTextNode(node.raw.slice(0, widget.start)),
		stampMathWidget(widget),
		document.createTextNode(node.raw.slice(widget.end).replace(/\n$/, ''))
	);
	document.body.appendChild(el);
	el.focus();

	const commits: { index: number; raw: string; before: number; after: number }[] = [];
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				cursor: new Proxy({}, { get: () => () => {} }),
				widgetSelection,
				blockEdit: { updateBlockContent: () => {} },
				focusActions: new Proxy({}, { get: () => () => {} }),
				setPendingCursor: () => {},
				setRevealing: () => {},
				isCrossBlock: () => false
			}
		)
	);

	// The within-block caret-edge dispatch classifies the widget and calls the
	// interaction's entry seam — the same split the cross-block enterEdgeWidget takes.
	const dispatch = createEdgePolicyDispatch({
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get linkRef() {
			return undefined;
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		hasIslands: () => false,
		getRawSelection: () => null,
		blockEdit: {
			updateBlockContent: (index: number, raw: string, before: number, after: number) =>
				commits.push({ index, raw, before, after })
		},
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => interaction.isRevealing(),
		enterWidget: (
			w: { start: number; end: number; kind: AnyInlineKind },
			fromTrailingEdge: boolean
		) => interaction.enterWidget(w, fromTrailingEdge),
		isReading: () => false
	} as unknown as EdgePolicyDispatchDeps);

	const key = (k: string) => new KeyboardEvent('keydown', { key: k });
	// Raw offset of the collapsed caret, node-agnostic: at a text-node boundary the
	// walk may anchor in either adjacent node, so the raw offset — not node identity —
	// is the direction oracle.
	const caretRaw = () => {
		const sel = window.getSelection()!;
		return domTextOffsetAtNode(el, sel.anchorNode!, sel.anchorOffset);
	};
	return { interaction, dispatch, widgetSelection, widget, commits, caretRaw, key };
}

// ── Within-block: edge-policy dispatch ───────────────────────────────────────

describe('edge dispatch — reveal-capable kind opens the reveal', () => {
	for (const [label, keyName, offsetSide] of [
		['ArrowLeft at the trailing edge', 'ArrowLeft', 'end'],
		['Backspace at the trailing edge', 'Backspace', 'end'],
		['ArrowRight at the leading edge', 'ArrowRight', 'start'],
		['Delete at the leading edge', 'Delete', 'start']
	] as const) {
		it(`${label} reveals the source without selecting`, () => {
			const b = mount('Before $x^2$ after', MATH_INLINE);
			const offset = asRawOffset(offsetSide === 'end' ? b.widget.end : b.widget.start);
			expect(b.dispatch.handleKeydown(b.key(keyName), offset)).toBe(true);
			expect(b.interaction.isRevealing()).toBe(true);
			expect(b.widgetSelection.getSelected()).toBeNull();
		});
	}

	it('places the caret at the trailing edge entering from the right', async () => {
		const b = mount('Before $x^2$ after', MATH_INLINE);
		b.dispatch.handleKeydown(b.key('ArrowLeft'), asRawOffset(b.widget.end));
		await new Promise((r) => setTimeout(r));
		expect(b.caretRaw()).toBe(b.widget.end);
	});

	it('places the caret at the leading edge entering from the left', async () => {
		const b = mount('Before $x^2$ after', MATH_INLINE);
		b.dispatch.handleKeydown(b.key('ArrowRight'), asRawOffset(b.widget.start));
		await new Promise((r) => setTimeout(r));
		expect(b.caretRaw()).toBe(b.widget.start);
	});
});

describe('edge dispatch — image kind keeps select-then-step', () => {
	it('ArrowLeft at the trailing edge selects, anchoring undo at the trailing edge', () => {
		const b = mount('lead ![cat](x.png)\n', 'image');
		expect(b.dispatch.handleKeydown(b.key('ArrowLeft'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.widgetSelection.getSelected()).toMatchObject({
			sourceStart: b.widget.start,
			preSelectOffset: b.widget.end
		});
	});

	it('ArrowRight at the leading edge selects, anchoring undo at the leading edge', () => {
		const b = mount('![cat](x.png) tail\n', 'image');
		expect(b.dispatch.handleKeydown(b.key('ArrowRight'), asRawOffset(b.widget.start))).toBe(true);
		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.widgetSelection.getSelected()).toMatchObject({
			sourceStart: b.widget.start,
			preSelectOffset: b.widget.start
		});
	});
});

// ── Atomic deleteGranularity: delete whole in one press, no select step ──────

describe('edge dispatch — an atomic kind deletes whole on one press', () => {
	// entityReference is the shipped deleteGranularity:'atomic' consumer (pinned in
	// its own block below). Reconfiguring the math kind as a synthetic atomic widget
	// proves the field is honored for ANY kind, not just the built-in entity. The
	// beforeEach reset re-registers math clean for the next test, so it never leaks.
	it('Backspace at the trailing edge removes the widget span through one CST edit', () => {
		// MATH_INLINE is the raw kind string; the augment API takes the branded kind.
		augmentInlineWidgetKind(MATH_INLINE as AnyInlineKind, {
			revealSource: false,
			deleteGranularity: 'atomic'
		});
		const b = mount('Before $x^2$ after', MATH_INLINE);
		expect(b.dispatch.handleKeydown(b.key('Backspace'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.widgetSelection.getSelected()).toBeNull();
		expect(b.commits).toHaveLength(1);
		expect(b.commits[0].after).toBe(b.widget.start);
		expect(b.commits[0].raw).not.toContain('$x^2$');
	});

	it('Delete at the leading edge removes the widget span the same way', () => {
		// MATH_INLINE is the raw kind string; the augment API takes the branded kind.
		augmentInlineWidgetKind(MATH_INLINE as AnyInlineKind, {
			revealSource: false,
			deleteGranularity: 'atomic'
		});
		const b = mount('$x^2$ tail', MATH_INLINE);
		expect(b.dispatch.handleKeydown(b.key('Delete'), asRawOffset(b.widget.start))).toBe(true);
		expect(b.commits).toHaveLength(1);
		expect(b.commits[0].raw).not.toContain('$x^2$');
	});
});

// ── Entity widget: the shipped step-over + atomic consumer ───────────────────

describe('edge dispatch — entityReference steps over and deletes atomically', () => {
	// `a&copy;b` renders © as an atomic widget spanning raw [1,7). No synthetic
	// override — this pins the built-in entity policy the registry ships.
	for (const [label, keyName, offsetSide] of [
		['ArrowLeft at the trailing edge', 'ArrowLeft', 'end'],
		['ArrowRight at the leading edge', 'ArrowRight', 'start']
	] as const) {
		it(`${label} declines so native steps the caret over the glyph, no select`, () => {
			const b = mount('a&copy;b', 'entityReference');
			const offset = asRawOffset(offsetSide === 'end' ? b.widget.end : b.widget.start);
			// A false return leaves the arrow to native contenteditable, which walks the
			// caret across the contenteditable=false island in one press.
			expect(b.dispatch.handleKeydown(b.key(keyName), offset)).toBe(false);
			expect(b.widgetSelection.getSelected()).toBeNull();
			expect(b.commits).toHaveLength(0);
		});
	}

	it('Backspace at the trailing edge removes the whole entity in one commit', () => {
		const b = mount('a&copy;b', 'entityReference');
		expect(b.dispatch.handleKeydown(b.key('Backspace'), asRawOffset(b.widget.end))).toBe(true);
		expect(b.widgetSelection.getSelected()).toBeNull();
		expect(b.commits).toHaveLength(1);
		expect(b.commits[0].raw).toBe('ab');
		expect(b.commits[0].after).toBe(b.widget.start);
	});

	it('Delete at the leading edge removes the whole entity the same way', () => {
		const b = mount('a&copy;b', 'entityReference');
		expect(b.dispatch.handleKeydown(b.key('Delete'), asRawOffset(b.widget.start))).toBe(true);
		expect(b.commits).toHaveLength(1);
		expect(b.commits[0].raw).toBe('ab');
	});
});

// ── Cross-block: enterEdgeWidget ─────────────────────────────────────────────

describe('enterEdgeWidget — cross-block landing dispatches on the same policy', () => {
	it('a trailing reveal-capable widget reveals instead of selecting', () => {
		const b = mount('tail $x^2$', MATH_INLINE);
		expect(b.interaction.enterEdgeWidget('end')).toBe(true);
		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.widgetSelection.getSelected()).toBeNull();
	});

	it('a leading reveal-capable widget reveals instead of selecting', () => {
		const b = mount('$x^2$ tail', MATH_INLINE);
		expect(b.interaction.enterEdgeWidget('start')).toBe(true);
		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.widgetSelection.getSelected()).toBeNull();
	});

	it('a trailing image widget selects, not reveals', () => {
		const b = mount('lead ![cat](x.png)\n', 'image');
		expect(b.interaction.enterEdgeWidget('end')).toBe(true);
		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.widgetSelection.getSelected()).toMatchObject({
			sourceStart: b.widget.start,
			preSelectOffset: b.widget.end
		});
	});
});
