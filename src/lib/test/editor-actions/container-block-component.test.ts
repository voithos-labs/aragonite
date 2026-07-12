// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createContainerBlockComponent } from '$lib/editor-actions/container-block-component';
import { CURSOR_END, FOCUS_LAST_START, type BlockComponent } from '$lib/block-component';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';

function makeRef(): BlockComponent {
	return {
		focus: vi.fn(),
		focusByPath: vi.fn(),
		focusAtColumn: vi.fn(),
		getCursorOffset: vi.fn(() => null),
		editable: true,
		focusable: true
	} as BlockComponent;
}

function listNode(childCount: number): CstNode {
	const children: CstNode[] = Array.from({ length: childCount }, () => ({
		kind: 'paragraph',
		leadingTrivia: '',
		raw: 'text\n'
	}));
	return { kind: 'list', leadingTrivia: '', raw: '', children };
}

function container(refs: BlockComponent[]): BlockComponent {
	return createContainerBlockComponent({
		get innerBlockRefs() {
			return refs;
		},
		get nodeChildrenLength() {
			return refs.length;
		},
		get node() {
			return listNode(refs.length);
		}
	});
}

describe('createContainerBlockComponent', () => {
	it('returns a BlockComponent with editable + focusable defaulted to true', () => {
		const c = container([]);
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

	// Collapse clamp: the body is unmounted, so a walk-in from below (which targets
	// the last child) must land on the summary (child 0), never the absent last ref.
	function collapsedContainer(refs: BlockComponent[]): BlockComponent {
		return createContainerBlockComponent({
			get innerBlockRefs() {
				return refs;
			},
			get nodeChildrenLength() {
				return refs.length;
			},
			get node() {
				return listNode(refs.length);
			},
			isCollapsed: () => true
		});
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
		const r2 = makeRef();
		(r2.getCursorOffset as any) = vi.fn(() => 7);
		expect(container([r1, r2]).getCursorOffset()).toBe(7);
	});

	it('focusByPath delegates to the path[0]-th ref', () => {
		const refs = [makeRef(), makeRef()];
		container(refs).focusByPath?.([1, 0], 5);
		expect(refs[1].focusByPath).toHaveBeenCalledWith([0], 5);
	});

	// Pure-data transparency reads the CST node, not the (possibly sparse,
	// off-window) refs — so it answers for an unmounted container (VR-6).
	it('isVerticallyTransparent reads the node, not refs', () => {
		const imageOnly: CstNode = {
			kind: 'list',
			leadingTrivia: '',
			raw: '',
			children: [
				{
					kind: 'paragraph',
					leadingTrivia: '',
					raw: '![pic](/x.png)\n'
				}
			]
		};
		const c = createContainerBlockComponent({
			get innerBlockRefs() {
				return [];
			},
			get nodeChildrenLength() {
				return 1;
			},
			get node() {
				return imageOnly;
			}
		});
		expect(c.isVerticallyTransparent?.()).toBe(true);
	});

	it('isVerticallyTransparent is false for a text-bearing container', () => {
		expect(container([makeRef()]).isVerticallyTransparent?.()).toBe(false);
	});
});

// Whole-block focus (opaque childless plugin block, e.g. mermaid): when a focus
// element getter is supplied, caret entry lands on that element instead of walking
// absent children, and the cursor offset reads 0 only while it (or a descendant)
// holds focus — the ThematicBreak model, exposed through the container shim.
describe('createContainerBlockComponent — whole-block focus (getFocusEl)', () => {
	function wholeBlock(focusEl: HTMLElement | null, refs: BlockComponent[] = []): BlockComponent {
		return createContainerBlockComponent({
			get innerBlockRefs() {
				return refs;
			},
			get nodeChildrenLength() {
				return refs.length;
			},
			get node() {
				return {
					kind: 'mermaid' as AnyBlockKind,
					leadingTrivia: '',
					raw: '',
					children: []
				} as CstNode;
			},
			getFocusEl: () => focusEl
		});
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
		document.body.focus(); // move focus off el
		expect(wholeBlock(el).getCursorOffset()).toBeNull();
	});

	it('a null focus element (render error state) makes focus a no-op, not a throw', () => {
		expect(() => wholeBlock(null).focus(0)).not.toThrow();
		expect(wholeBlock(null).getCursorOffset()).toBeNull();
	});
});
