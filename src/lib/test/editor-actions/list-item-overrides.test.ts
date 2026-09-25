import { describe, it, expect, vi, type Mocked } from 'vitest';
import type { ListContext } from '$lib/action-contracts';
import type { NestedActionsBundle } from '$lib/editor-actions/nested/nested-actions';
import { createListItemOverrides } from '$lib/editor-actions/list-overrides';
import { parse } from '$lib/core/parser';

// Enter inside a list item is one of three item-level moves, never a prose split of the item's
// paragraph: leaving the list, a new item, or the item cut in two.

function listContextSpy(): Mocked<ListContext> {
	return {
		insertItemAfter: vi.fn(async () => {}),
		exitListAtItem: vi.fn(async () => {}),
		indentItem: vi.fn(async () => {}),
		unindentItem: vi.fn(async () => {}),
		splitItemAtOffset: vi.fn(async () => {}),
		promoteNestedItem: vi.fn(async () => {}),
		getContainingItemIndex: vi.fn(() => 0)
	};
}

function enterIn(source: string, innerIndex: number, offset: number) {
	const item = parse(source).children[0].children![0];
	const listContext = listContextSpy();
	const overrides = createListItemOverrides({
		scope: { index: 2, node: item, path: [0, 2] },
		listContext
	})({} as NestedActionsBundle);
	return { listContext, run: () => overrides.blockEdit!.splitBlock!(innerIndex, offset) };
}

describe('a list item’s Enter', () => {
	it('leaves the list from an empty item', async () => {
		const { listContext, run } = enterIn('- \n', 0, 0);
		await run();
		expect(listContext.exitListAtItem).toHaveBeenCalledWith(2);
		expect(listContext.splitItemAtOffset).not.toHaveBeenCalled();
	});

	it('starts the next item at the end of the item’s last block', async () => {
		const { listContext, run } = enterIn('- abc\n', 0, 3);
		await run();
		expect(listContext.insertItemAfter).toHaveBeenCalledWith(2);
	});

	it('cuts the item in two anywhere else', async () => {
		const { listContext, run } = enterIn('- abc\n', 0, 1);
		await run();
		expect(listContext.splitItemAtOffset).toHaveBeenCalledWith(2, 0, 1);
		expect(listContext.insertItemAfter).not.toHaveBeenCalled();
	});
});
