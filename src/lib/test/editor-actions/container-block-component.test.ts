// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createContainerBlockComponent } from '$lib/editor-actions/container-block-component';
import { CURSOR_END, FOCUS_LAST_START, type BlockComponent } from '$lib/block-component';
import type { CstNode } from '$lib/core/nodes';

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
