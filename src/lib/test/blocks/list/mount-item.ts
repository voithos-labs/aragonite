// A list item mounted on its own, with a recording `ListContext` underneath it. The gesture
// suites beside it mount the Editor, which is what asserting source bytes needs; this is for the
// other half, because the item's keydown handler only decides, and the honest reading of "let it
// travel" is `defaultPrevented` plus a `ListContext` nothing touched. Through an Editor both are
// hidden: the editor root handles what the item declines, and a real context turns a decision
// into a commit.

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

/** Mounts item `itemIndex` of the list parsed from `source`. */
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
		props: { itemCount: doc.children[0].children!.length },
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
