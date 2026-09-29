// A list item mounted on its own with a recording `ListContext`, for asserting what the item's
// keydown handler decides: `defaultPrevented` plus the context calls. Through an Editor both are
// hidden, since the editor root handles what the item declines and a real context commits.

import { vi } from 'vitest';
import ListItemBlock from '$lib/components/blocks/list/ListItemBlock.svelte';
import type { ListContext } from '$lib/action-contracts';
import { LIST_CONTEXT_KEY } from '$lib/editor-keys';
import { parse } from '$lib/core/parser';
import { mountBlock } from '../../harness/mount-block';
import type { MountContextOverrides } from '../../harness/mount-context';

export type RecordingListContext = { [K in keyof ListContext]: ReturnType<typeof vi.fn> };

function makeRecordingListContext(): RecordingListContext {
	return {
		insertItemAfter: vi.fn(),
		exitListAtItem: vi.fn(),
		indentItem: vi.fn(),
		unindentItem: vi.fn(),
		splitItemAtOffset: vi.fn(),
		promoteNestedItem: vi.fn(),
		getContainingItemIndex: vi.fn(() => 0)
	};
}

export interface MountedItem {
	box: HTMLElement;
	content: HTMLElement;
	listContext: RecordingListContext;
	dispose(): Promise<void>;
}

export function mountItem(
	source: string,
	itemIndex = 0,
	overrides: MountContextOverrides = {}
): MountedItem {
	const listContext = makeRecordingListContext();
	const doc = parse(source);
	const mounted = mountBlock(ListItemBlock, {
		doc,
		path: [0, itemIndex],
		props: { id: `item-${itemIndex}`, itemCount: doc.children[0].children!.length },
		overrides,
		context: [[LIST_CONTEXT_KEY, listContext]]
	});
	return {
		box: mounted.target.querySelector('.list-item-block') as HTMLElement,
		content: mounted.target.querySelector('.list-item-content') as HTMLElement,
		listContext,
		dispose: mounted.dispose
	};
}
