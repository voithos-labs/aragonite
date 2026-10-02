// Miss-analysis: every container move test stubbed each ref as mounted, so a sibling the render
// window left out was never a target, and only the root's move mounted one.
import { describe, it, expect, vi } from 'vitest';
import { CURSOR_START, type BlockComponent } from '$lib/block-component';
import { createNestedFocus } from '$lib/editor-actions/nested/nested-focus';
import type { ChildList } from '$lib/reactivity/child-list';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
import {
	makeCaretMemory,
	makeStubFocus,
	paragraphListNode,
	stubBlockComponent
} from '$lib/test/harness/editor-actions';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { createDocumentStamps } from '$lib/editor-actions/commit/document-stamp';

const COUNT = 30;

/** A container of `COUNT` paragraphs with only the first two mounted; scrolling to a child
 *  mounts `target` there. */
function windowedContainer(target: BlockComponent) {
	const refs: (BlockComponent | undefined)[] = [stubBlockComponent(), stubBlockComponent()];
	const inRange = new Set([0, 1]);
	const childList: ChildList = {
		count: () => COUNT,
		refs: refSlotsOver(refs),
		windowing: {
			revealChild: vi.fn(async (index: number) => {
				inRange.add(index);
				refs[index] = target;
			}),
			isInWindow: (index) => inRange.has(index)
		}
	};
	const parentFocus = makeStubFocus();
	const focus = createNestedFocus(
		{ innerBlockIds: [], innerBlockRefs: refs, refSlots: childList.refs },
		{
			index: 4,
			node: paragraphListNode(COUNT),
			path: [4],
			caretMemory: makeCaretMemory(),
			reading: fixtureReading(),
			stamps: createDocumentStamps(),
			childList: () => childList,
			parent: { blockEdit: {} as never, focus: parentFocus, containerEdit: {} as never }
		}
	);
	return { focus, parentFocus, childList };
}

describe('a move inside a container', () => {
	it('mounts a sibling the render window left out and lands there', async () => {
		const target = stubBlockComponent({ focus: vi.fn() });
		const { focus, parentFocus, childList } = windowedContainer(target);

		await focus.moveFocus(20, 'start');

		expect(childList.windowing.revealChild).toHaveBeenCalledWith(20);
		expect(target.focus).toHaveBeenCalledWith(CURSOR_START);
		// Skipping the unmounted child would walk off the end and hand the move to the parent.
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});
});
