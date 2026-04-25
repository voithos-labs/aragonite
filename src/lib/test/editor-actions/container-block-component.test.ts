// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createContainerBlockComponent } from '$lib/editor/editor-actions/container-block-component';
import { FOCUS_LAST_START, CURSOR_END, type BlockComponent } from '$lib/editor/contracts';

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

describe('createContainerBlockComponent', () => {
	it('focus(0) targets the first child ref', () => {
		const refs = [makeRef(), makeRef()];
		const c = createContainerBlockComponent({
			get innerBlockRefs() { return refs; },
			get nodeChildrenLength() { return 2; }
		});
		c.focus(0);
		expect(refs[0].focus).toHaveBeenCalledWith(0);
	});

	it('focus(FOCUS_LAST_START) cascades to the last child', () => {
		const refs = [makeRef(), makeRef()];
		const c = createContainerBlockComponent({
			get innerBlockRefs() { return refs; },
			get nodeChildrenLength() { return 2; }
		});
		c.focus(FOCUS_LAST_START);
		expect(refs[1].focus).toHaveBeenCalledWith(FOCUS_LAST_START);
	});

	it('focus(<other offset>) targets the last child with CURSOR_END', () => {
		const refs = [makeRef(), makeRef()];
		const c = createContainerBlockComponent({
			get innerBlockRefs() { return refs; },
			get nodeChildrenLength() { return 2; }
		});
		c.focus(3);
		expect(refs[1].focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('focus is a no-op when no children', () => {
		const refs: BlockComponent[] = [];
		const c = createContainerBlockComponent({
			get innerBlockRefs() { return refs; },
			get nodeChildrenLength() { return 0; }
		});
		expect(() => c.focus(0)).not.toThrow();
	});

	it('focusAtColumn is a no-op when no children', () => {
		const refs: BlockComponent[] = [];
		const c = createContainerBlockComponent({
			get innerBlockRefs() { return refs; },
			get nodeChildrenLength() { return 0; }
		});
		expect(() => c.focusAtColumn?.(100, 'above')).not.toThrow();
	});

	it('getCursorOffset returns first ref reporting an offset', () => {
		const r1 = makeRef();
		const r2 = makeRef();
		(r2.getCursorOffset as any) = vi.fn(() => 7);
		const c = createContainerBlockComponent({
			get innerBlockRefs() { return [r1, r2]; },
			get nodeChildrenLength() { return 2; }
		});
		expect(c.getCursorOffset()).toBe(7);
	});

	it('focusByPath delegates to the path[0]-th ref', () => {
		const refs = [makeRef(), makeRef()];
		const c = createContainerBlockComponent({
			get innerBlockRefs() { return refs; },
			get nodeChildrenLength() { return 2; }
		});
		c.focusByPath?.([1, 0], 5);
		expect(refs[1].focusByPath).toHaveBeenCalledWith([0], 5);
	});
});
