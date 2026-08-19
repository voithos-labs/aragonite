// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createContainerBlockComponent } from '$lib/editor-actions/container-block-component';
import { CURSOR_END, FOCUS_LAST_START, type BlockComponent } from '$lib/block-component';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';
import { makeShimDeps } from '$lib/test/harness/editor-actions';

function makeRef(overrides: Partial<BlockComponent> = {}): BlockComponent {
	return {
		focus: vi.fn(),
		parkCaret: vi.fn(),
		focusByPath: vi.fn(),
		focusAtColumn: vi.fn(),
		getCursorOffset: vi.fn(() => null),
		editable: true,
		focusable: true,
		...overrides
	} as BlockComponent;
}

const mermaidNode = (): CstNode =>
	({ kind: 'mermaid' as AnyBlockKind, leadingTrivia: '', raw: '', children: [] }) as CstNode;

function container(refs: BlockComponent[]): BlockComponent {
	return createContainerBlockComponent(makeShimDeps(refs));
}

describe('createContainerBlockComponent', () => {
	it('returns a BlockComponent with editable + focusable defaulted to true', () => {
		const c = container([]);
		expect(c.editable).toBe(true);
		expect(c.focusable).toBe(true);
	});

	// Miss-analysis: the flag was a literal `true` with no reader, so no test could tell a
	// declared value from the hardcode — the only pin was the default it never left.
	it('reports the declared editable value, re-read live', () => {
		let declared = false;
		const c = createContainerBlockComponent(
			makeShimDeps([], {
				get editable() {
					return declared;
				}
			})
		);
		expect(c.editable).toBe(false);
		// A snapshot dep would freeze the first read; focusability is a separate axis.
		declared = true;
		expect(c.editable).toBe(true);
		expect(c.focusable).toBe(true);
	});

	it('focus(0) targets the first child ref', () => {
		const refs = [makeRef(), makeRef()];
		container(refs).focus(0);
		expect(refs[0].focus).toHaveBeenCalledWith(0);
	});

	it('focus(FOCUS_LAST_START) cascades to the last child', () => {
		const refs = [makeRef(), makeRef()];
		container(refs).focus(FOCUS_LAST_START);
		expect(refs[1].focus).toHaveBeenCalledWith(FOCUS_LAST_START);
	});

	it('focus(<other offset>) targets the last child with CURSOR_END', () => {
		const refs = [makeRef(), makeRef()];
		container(refs).focus(3);
		expect(refs[1].focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('focus is a no-op when no children', () => {
		expect(() => container([]).focus(0)).not.toThrow();
	});

	// The body is unmounted, so a walk-in from below must clamp to child 0, never the
	// absent last ref.
	function collapsedContainer(refs: BlockComponent[]): BlockComponent {
		return createContainerBlockComponent(makeShimDeps(refs, { isCollapsed: () => true }));
	}

	it('collapsed: focus(FOCUS_LAST_START) clamps to child 0, not the last child', () => {
		const refs = [makeRef(), makeRef()];
		collapsedContainer(refs).focus(FOCUS_LAST_START);
		expect(refs[0].focus).toHaveBeenCalledWith(FOCUS_LAST_START);
		expect(refs[1].focus).not.toHaveBeenCalled();
	});

	it('collapsed: focus(<other offset>) clamps CURSOR_END to child 0', () => {
		const refs = [makeRef(), makeRef()];
		collapsedContainer(refs).focus(3);
		expect(refs[0].focus).toHaveBeenCalledWith(CURSOR_END);
		expect(refs[1].focus).not.toHaveBeenCalled();
	});

	it('focusAtColumn is a no-op when no children', () => {
		expect(() => container([]).focusAtColumn?.(100, 'above')).not.toThrow();
	});

	it('getCursorOffset returns first ref reporting an offset', () => {
		const r1 = makeRef();
		const r2 = makeRef({ getCursorOffset: () => 7 });
		expect(container([r1, r2]).getCursorOffset()).toBe(7);
	});

	it('focusByPath delegates to the path[0]-th ref', () => {
		const refs = [makeRef(), makeRef()];
		container(refs).focusByPath?.([1, 0], 5);
		expect(refs[1].focusByPath).toHaveBeenCalledWith([0], 5);
	});

	// Reading the CST node rather than the sparse refs is what lets it answer for an
	// unmounted container (VR-6).
	it('isVerticallyTransparent reads the node, not refs', () => {
		const imageOnly: CstNode = {
			kind: 'list',
			leadingTrivia: '',
			raw: '',
			metadata: { ordered: false },
			children: [
				{
					kind: 'paragraph',
					leadingTrivia: '',
					raw: '![pic](/x.png)\n'
				}
			]
		};
		const c = createContainerBlockComponent(
			makeShimDeps([], { nodeChildrenLength: 1, node: imageOnly })
		);
		expect(c.isVerticallyTransparent?.()).toBe(true);
	});

	it('isVerticallyTransparent is false for a text-bearing container', () => {
		expect(container([makeRef()]).isVerticallyTransparent?.()).toBe(false);
	});
});

// `focus` ends a live cross-block range so the next keystroke can't type-replace the
// document; `parkCaret` deliberately does not.
describe('createContainerBlockComponent — the two caret doors', () => {
	function withRange(refs: BlockComponent[]) {
		const selection = createSelectionState();
		selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [4], offset: 2 });
		return { selection, api: createContainerBlockComponent(makeShimDeps(refs, { selection })) };
	}

	it('focus ends a live cross-block range', () => {
		const refs = [makeRef(), makeRef()];
		const { selection, api } = withRange(refs);

		api.focus(0);

		expect(selection.isCrossBlock).toBe(false);
		expect(refs[0].focus).toHaveBeenCalledWith(0);
	});

	it('parkCaret leaves it live — the extend paths depend on that', () => {
		const refs = [makeRef(), makeRef()];
		const { selection, api } = withRange(refs);

		api.parkCaret?.(0);

		expect(selection.isCrossBlock).toBe(true);
		expect(refs[0].parkCaret).toHaveBeenCalledWith(0);
	});

	// The half that matters: the extend's range survives (BlockComponent.parkCaret).
	it('a child without the park door is skipped, not landed through focus', () => {
		const bare = { focus: vi.fn(), getCursorOffset: () => null } as unknown as BlockComponent;
		const { selection, api } = withRange([bare]);

		api.parkCaret?.(0);

		expect(bare.focus).not.toHaveBeenCalled();
		expect(selection.isCrossBlock).toBe(true);
	});

	// `parkCaret` is optional so an external leaf may omit it; the documented cost is a
	// missed PARK, never a stranded caret on an ordinary focus walk.
	it('focus lands in a child without the park door, through its focus', () => {
		const bare = { focus: vi.fn(), getCursorOffset: () => null } as unknown as BlockComponent;
		const { selection, api } = withRange([bare]);

		api.focus(0);

		expect(bare.focus).toHaveBeenCalledWith(0);
		expect(selection.isCrossBlock).toBe(false);
	});
});

// The ThematicBreak model exposed through the container shim: with a focus element
// getter, caret entry lands on that element instead of walking absent children.
describe('createContainerBlockComponent — whole-block focus (getFocusEl)', () => {
	function wholeBlock(focusEl: HTMLElement | null, refs: BlockComponent[] = []): BlockComponent {
		return createContainerBlockComponent(
			makeShimDeps(refs, { node: mermaidNode(), getFocusEl: () => focusEl })
		);
	}

	function focusableEl(): HTMLElement {
		const el = document.createElement('div');
		el.tabIndex = 0;
		document.body.appendChild(el);
		return el;
	}

	it('focus() lands on the focus element, never the children', () => {
		const el = focusableEl();
		const child = makeRef();
		wholeBlock(el, [child]).focus(0);
		expect(document.activeElement).toBe(el);
		expect(child.focus).not.toHaveBeenCalled();
		expect(child.parkCaret).not.toHaveBeenCalled();
	});

	it('focusAtColumn() also lands on the focus element (vertical entry)', () => {
		const el = focusableEl();
		wholeBlock(el).focusAtColumn?.(120, 'above');
		expect(document.activeElement).toBe(el);
	});

	it('getCursorOffset() is 0 while the focus element holds focus', () => {
		const el = focusableEl();
		el.focus();
		expect(wholeBlock(el).getCursorOffset()).toBe(0);
	});

	it('getCursorOffset() is 0 while a descendant holds focus (click on the viewport)', () => {
		const el = focusableEl();
		const inner = document.createElement('button');
		el.appendChild(inner);
		inner.focus();
		expect(el.contains(document.activeElement)).toBe(true);
		expect(wholeBlock(el).getCursorOffset()).toBe(0);
	});

	it('getCursorOffset() is null when the focus element does not hold focus', () => {
		const el = focusableEl();
		document.body.focus();
		expect(wholeBlock(el).getCursorOffset()).toBeNull();
	});

	it('a null focus element (render error state) makes focus a no-op, not a throw', () => {
		expect(() => wholeBlock(null).focus(0)).not.toThrow();
		expect(wholeBlock(null).getCursorOffset()).toBeNull();
	});
});

// The shim ALWAYS exposes measurePartialRects, the seam the search/decoration overlays
// measure a childless container through. A child-bearing container returns nothing and
// is never asked: the overlay gates on delegatesPainting, not on this return.
describe('createContainerBlockComponent — measurePartialRects (opaque single-unit)', () => {
	const RECT = { left: 4, top: 8, width: 120, height: 40 } as unknown as DOMRect;
	const boxEl = () => ({ getBoundingClientRect: () => RECT }) as unknown as HTMLElement;

	function shim(over: {
		childCount?: number;
		getBoxEl?: () => HTMLElement | null | undefined;
	}): BlockComponent {
		return createContainerBlockComponent(
			makeShimDeps([], {
				nodeChildrenLength: over.childCount ?? 0,
				node: mermaidNode(),
				getBoxEl: over.getBoxEl
			})
		);
	}

	it('is always present on the shim', () => {
		expect(shim({}).measurePartialRects).toBeTypeOf('function');
	});

	it('a child-bearing container returns [] — children self-paint', () => {
		expect(shim({ childCount: 2, getBoxEl: boxEl }).measurePartialRects!(0, 5)).toEqual([]);
	});

	it('childless with a box returns one box rect for any non-empty range', () => {
		expect(shim({ getBoxEl: boxEl }).measurePartialRects!(0, 5)).toEqual([RECT]);
	});

	it('childless with an empty range returns []', () => {
		expect(shim({ getBoxEl: boxEl }).measurePartialRects!(3, 3)).toEqual([]);
	});

	it('childless with no box element returns []', () => {
		expect(shim({ getBoxEl: () => null }).measurePartialRects!(0, 5)).toEqual([]);
	});
});
