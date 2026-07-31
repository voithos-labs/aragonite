// A list item mounted BY ITSELF, with a recording ListContext underneath it. The gesture suites
// beside it mount the Editor, which is what asserting SOURCE BYTES needs; this is for the other
// half — the item's keydown handler is a dispatch decision, and the only honest reading of "let it
// travel" is `defaultPrevented` plus an untouched ListContext. Through an Editor both are hidden:
// the editor root handles what the item declines, and a real context turns a claim into a commit.

import { mount, unmount, flushSync } from 'svelte';
import { vi } from 'vitest';
import ListItemBlock from '$lib/components/blocks/list/ListItemBlock.svelte';
import type { ListContext } from '$lib/action-contracts';
import { LIST_CONTEXT_KEY } from '$lib/editor-keys';
import { parse } from '$lib/core/parser';
import { editorMountContext, type MountContextOverrides } from '../../harness/mount-context';

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
	const doc = parse(source);
	const list = doc.children[0];
	const listContext = makeRecordingListContext();

	const target = document.createElement('div');
	document.body.appendChild(target);
	const context = editorMountContext({ ...overrides, doc: { doc: () => doc, ...overrides.doc } });
	context.set(LIST_CONTEXT_KEY, listContext as unknown as ListContext);
	const instance = mount(ListItemBlock, {
		target,
		props: { node: list.children![itemIndex], index: itemIndex, myPath: [0, itemIndex] },
		context
	});
	flushSync();

	return {
		box: target.querySelector('.list-item-block') as HTMLElement,
		content: target.querySelector('.list-item-content') as HTMLElement,
		listContext,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

/** Dispatch a bubbling, cancelable keydown at `el` and report whether it was consumed. */
export function pressOn(el: HTMLElement, init: KeyboardEventInit): boolean {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(event);
	return event.defaultPrevented;
}
