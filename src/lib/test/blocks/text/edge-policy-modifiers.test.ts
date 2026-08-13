// @vitest-environment jsdom
//
// Modifier parity on the caret-edge dispatch's CST-widget arm. The contract is "one PLAIN key at
// a caret edge routes here"; the island arm enforces it (edge-policy-islands.test.ts) and this arm
// read only shiftKey, so Ctrl+ArrowLeft entered the widget instead of moving the caret — modal for
// an image, so the next printable key replaced the construct's bytes. Pinned at the dispatch's own
// decision (declined, entry seam untouched) rather than through the modal state it would open.
import { afterEach, describe, expect, it } from 'vitest';
import {
	createEdgePolicyDispatch,
	type EdgePolicyDispatchDeps
} from '$lib/components/blocks/text/edge-policy-dispatch';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import type { BlockEditActions } from '$lib/action-contracts';
import type { CstNode, InlineNode } from '$lib/core/nodes';
import { stampMathWidget } from './math-widget-fixture';
import { makePendingMarks } from '$lib/test/harness/editor-actions';

/** Mount [prose][atomic island][prose] around `source`'s first widget of `kind` and
 *  wire the dispatch with a recording entry seam. */
function mount(source: string, kind: string) {
	const node: CstNode = parse(source).children[0];
	const widget = computeInlineContent(node).find((n: InlineNode) => n.kind === kind)!;

	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(
		document.createTextNode(node.raw.slice(0, widget.start)),
		stampMathWidget(widget),
		document.createTextNode(node.raw.slice(widget.end).replace(/\n$/, ''))
	);
	document.body.appendChild(el);

	const entered: { start: number; fromTrailingEdge: boolean }[] = [];
	const edits: unknown[] = [];
	const deps: EdgePolicyDispatchDeps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get containerParent() {
			return null;
		},
		get linkRef() {
			return undefined;
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		hasIslands: () => false,
		getRawSelection: () => null,
		blockEdit: {
			updateBlockContent: (...args: unknown[]) => edits.push(args)
		} as unknown as BlockEditActions,
		setPendingCursor: () => {},
		setSnapTarget: () => {},
		isRevealing: () => false,
		enterWidget: (w, fromTrailingEdge) => entered.push({ start: w.start, fromTrailingEdge }),
		isReading: () => false,
		getEdgeAffinity: () => null,
		pendingMarks: makePendingMarks(),
		installedAs: 'block'
	};
	return { dispatch: createEdgePolicyDispatch(deps), widget, entered, edits };
}

function key(name: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: name, cancelable: true, ...modifiers });
}

afterEach(() => {
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('a modifier chord at a widget edge is not a widget entry', () => {
	const chords: Partial<KeyboardEvent>[] = [{ ctrlKey: true }, { metaKey: true }, { altKey: true }];

	// Both entry directions and both key families the arm claims: navigation (word-step) and
	// destructive (word-delete). Each is a platform chord meaning "act on a word".
	for (const [label, keyName, side] of [
		['ArrowLeft at the trailing edge', 'ArrowLeft', 'end'],
		['Backspace at the trailing edge', 'Backspace', 'end'],
		['ArrowRight at the leading edge', 'ArrowRight', 'start'],
		['Delete at the leading edge', 'Delete', 'start']
	] as const) {
		it.each(chords)(`${label} with %o stays native`, (mods) => {
			const b = mount('hello ![a](u) world', 'image');
			const offset = asRawOffset(side === 'end' ? b.widget.end : b.widget.start);
			const e = key(keyName, mods);

			expect(b.dispatch.handleKeydown(e, offset)).toBe(false);
			expect(b.entered).toEqual([]);
			expect(e.defaultPrevented).toBe(false);
			expect(b.edits).toEqual([]);
		});
	}

	// Non-vacuity: the same key without the chord is still the widget entry, so the
	// guard narrows the arm rather than disabling it.
	it('the same key with no chord still enters the widget', () => {
		const b = mount('hello ![a](u) world', 'image');
		const e = key('ArrowLeft');

		expect(b.dispatch.handleKeydown(e, asRawOffset(b.widget.end))).toBe(true);
		expect(b.entered).toEqual([{ start: b.widget.start, fromTrailingEdge: true }]);
		expect(e.defaultPrevented).toBe(true);
	});

	// Shift is the separate, older rule: a shift-arrow extends a selection into the
	// widget through widget-interaction, so the edge arm has always declined it.
	it('Shift+ArrowLeft still declines, leaving the extend seam to own it', () => {
		const b = mount('hello ![a](u) world', 'image');

		expect(
			b.dispatch.handleKeydown(key('ArrowLeft', { shiftKey: true }), asRawOffset(b.widget.end))
		).toBe(false);
		expect(b.entered).toEqual([]);
	});
});
