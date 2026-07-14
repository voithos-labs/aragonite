// @vitest-environment jsdom
//
// Caret-entry against a widget edge dispatches on the widget kind's revealSource
// policy at TWO seams — the within-block `handleWidgetAtCursorKeydown` (all four
// entry keys) and the cross-block `enterEdgeWidget`. Reveal-capable kinds (inline
// math) open the source reveal at the direction-appropriate edge; non-reveal kinds
// (image) keep select-then-step. This pins the split at both seams so a regression
// to N−1-of-N sibling parity fails here, not only in e2e.
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
	createWidgetInteraction,
	type WidgetInteractionDeps
} from '$lib/components/blocks/text/widget-interaction';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { augmentInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { imageWidgetOnSelectedKey } from '$lib/components/image/image-widget-editing';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { rawTextOfNode, rawOffsetAtNode } from '$lib/cursor/widget-offset';
import type { CstNode, InlineNode } from '$lib/core/nodes';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { stampMathWidget, resetInlineState } from './math-widget-fixture';

beforeEach(() => {
	resetInlineState();
	registerMathInline();
	augmentInlineWidgetKind('image', { onSelectedKey: imageWidgetOnSelectedKey });
});

afterEach(() => {
	document.body.innerHTML = '';
	resetInlineState();
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

	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	const interaction = createWidgetInteraction({
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		getEditorContentWidth: () => 800,
		cursor: new Proxy({}, { get: () => () => {} }),
		widgetSelection,
		blockEdit: { updateBlockContent: () => {} },
		focusActions: new Proxy({}, { get: () => () => {} }),
		getSnapTarget: () => null,
		setSnapTarget: () => {},
		setPendingCursor: () => {},
		readRawText: () =>
			Array.from(el.childNodes).reduce((acc, child) => acc + rawTextOfNode(child, node.raw), ''),
		setRevealing: () => {},
		isCrossBlock: () => false,
		get linkRef() {
			return undefined;
		}
	} as unknown as WidgetInteractionDeps);

	const key = (k: string) => new KeyboardEvent('keydown', { key: k });
	// Raw offset of the collapsed caret, node-agnostic: at a text-node boundary the
	// walk may anchor in either adjacent node, so the raw offset — not node identity —
	// is the direction oracle.
	const caretRaw = () => {
		const sel = window.getSelection()!;
		return rawOffsetAtNode(el, sel.anchorNode!, sel.anchorOffset);
	};
	return { interaction, widgetSelection, widget, caretRaw, key };
}

// ── Within-block: handleWidgetAtCursorKeydown ────────────────────────────────

describe('handleWidgetAtCursorKeydown — reveal-capable kind opens the reveal', () => {
	for (const [label, keyName, offsetSide] of [
		['ArrowLeft at the trailing edge', 'ArrowLeft', 'end'],
		['Backspace at the trailing edge', 'Backspace', 'end'],
		['ArrowRight at the leading edge', 'ArrowRight', 'start'],
		['Delete at the leading edge', 'Delete', 'start']
	] as const) {
		it(`${label} reveals the source without selecting`, () => {
			const b = mount('Before $x^2$ after', MATH_INLINE);
			const offset = offsetSide === 'end' ? b.widget.end : b.widget.start;
			expect(b.interaction.handleWidgetAtCursorKeydown(b.key(keyName), offset)).toBe(true);
			expect(b.interaction.isRevealing()).toBe(true);
			expect(b.widgetSelection.getSelected()).toBeNull();
		});
	}

	it('places the caret at the trailing edge entering from the right', async () => {
		const b = mount('Before $x^2$ after', MATH_INLINE);
		b.interaction.handleWidgetAtCursorKeydown(b.key('ArrowLeft'), b.widget.end);
		await new Promise((r) => setTimeout(r));
		expect(b.caretRaw()).toBe(b.widget.end);
	});

	it('places the caret at the leading edge entering from the left', async () => {
		const b = mount('Before $x^2$ after', MATH_INLINE);
		b.interaction.handleWidgetAtCursorKeydown(b.key('ArrowRight'), b.widget.start);
		await new Promise((r) => setTimeout(r));
		expect(b.caretRaw()).toBe(b.widget.start);
	});
});

describe('handleWidgetAtCursorKeydown — image kind keeps select-then-step', () => {
	it('ArrowLeft at the trailing edge selects, anchoring undo at the trailing edge', () => {
		const b = mount('lead ![cat](x.png)\n', 'image');
		expect(b.interaction.handleWidgetAtCursorKeydown(b.key('ArrowLeft'), b.widget.end)).toBe(true);
		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.widgetSelection.getSelected()).toMatchObject({
			sourceStart: b.widget.start,
			preSelectOffset: b.widget.end
		});
	});

	it('ArrowRight at the leading edge selects, anchoring undo at the leading edge', () => {
		const b = mount('![cat](x.png) tail\n', 'image');
		expect(b.interaction.handleWidgetAtCursorKeydown(b.key('ArrowRight'), b.widget.start)).toBe(
			true
		);
		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.widgetSelection.getSelected()).toMatchObject({
			sourceStart: b.widget.start,
			preSelectOffset: b.widget.start
		});
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
