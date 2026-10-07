// A caret landing over a parsed document for restore tests: every block mounts when the descent
// asks, and each mounted path is recorded. `mounted: false` answers no element, so a placement
// finds nothing to put the caret in.

import type { BlockComponent } from '#lib/block-component.js';
import type { Document } from '#lib/core/nodes.js';
import { createCaretMemory, type CaretMemory } from '#lib/cursor/caret-memory.js';
import type { ChildList } from '#lib/reactivity/child-list.js';
import { refSlotsOver } from '#lib/reactivity/publish-ref.svelte.js';
import { createCaretLanding } from '#lib/selection/caret-landing.js';
import type { RestoreTarget } from '#lib/selection/native-bridge.js';
import type { SelectionState } from '#lib/selection/selection-state.svelte.js';
import { stubBlockComponent } from '#lib/testing/headless-actions.js';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';

/** What `applySelectionToDom` writes into, with a caret at each endpoint's own cell. */
export function restoreTarget(
	selectionState: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): RestoreTarget {
	return {
		selectionState,
		getBlockElByPath,
		caretAt: (point) => selectionState.cellLandingFor(point),
		getEditorRoot: () => null
	};
}

export function restoreLandingOver(
	doc: Document,
	selectionState: SelectionState,
	{
		mounted = true,
		caretMemory = createCaretMemory() as CaretMemory,
		getBlockElByPath = (): HTMLElement | null => (mounted ? document.createElement('div') : null)
	}: {
		mounted?: boolean;
		caretMemory?: CaretMemory;
		getBlockElByPath?: (path: number[]) => HTMLElement | null;
	} = {}
) {
	const revealed: number[][] = [];
	const listAt = (path: number[]): ChildList => {
		const refs: (BlockComponent | undefined)[] = [];
		return {
			count: () => nodeAt(doc, path)?.children?.length ?? 0,
			refs: refSlotsOver(refs),
			windowing: {
				async revealChild(index) {
					const at = [...path, index];
					revealed.push(at);
					refs[index] = stubBlockComponent({ childList: () => listAt(at) });
				},
				isInWindow: (index) => refs[index] !== undefined
			}
		};
	};
	const landing = createCaretLanding({
		getDoc: () => doc,
		root: listAt([]),
		selectionState,
		caretMemory,
		getBlockElByPath,
		getEditorRoot: () => null,
		scroll: null
	});
	return { landing, revealed, caretMemory };
}
