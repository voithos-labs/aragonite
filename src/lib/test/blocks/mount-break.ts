// ThematicBreakBlock mounted as the middle block of a three-block document, which is the
// whole-block-focus kind, with the editing host it publishes and the stubs its wiring reads.

import { vi } from 'vitest';
import ThematicBreakBlock from '$lib/components/blocks/ThematicBreakBlock.svelte';
import type { EditorServices } from '$lib/editor-keys';
import type { PresentationMode } from '$lib/presentation-mode';
import { WHOLE_BLOCK_INPUT_ATTR } from '$lib/editor-actions/whole-block-focus-surface';
import { parse } from '$lib/core/parser';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { makeStubFocus } from '../harness/editor-actions';
import { mountBlock } from '../harness/mount-block';

export const BREAK_RAW = '---\n';
export const BREAK_INDEX = 1;

export function mountBreak(presentationMode: PresentationMode = 'source') {
	const doc = parse(`a\n\n${BREAK_RAW}\nb\n`);
	// Kind dispatch reads the node, so a fixture drift would silently mount this component
	// over a paragraph and leave every assertion still passing.
	if (doc.children[BREAK_INDEX].kind !== 'thematicBreak') {
		throw new Error(`fixture drift: block ${BREAK_INDEX} is ${doc.children[BREAK_INDEX].kind}`);
	}
	const focus = makeStubFocus();
	const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
	const reorder = { nudgeReorderUnit: vi.fn() } as unknown as EditorServices['reorder'];
	const selection = createSelectionState();
	const mounted = mountBlock(ThematicBreakBlock, {
		doc,
		path: [BREAK_INDEX],
		overrides: {
			focus,
			history,
			services: { reorder, selection },
			policies: { presentationMode: () => presentationMode }
		}
	});
	const el = mounted.target.querySelector('.thematic-break-block') as HTMLElement;
	return {
		...mounted,
		el,
		host: el.querySelector(`[${WHOLE_BLOCK_INPUT_ATTR}]`) as HTMLElement,
		focus,
		history,
		reorder,
		selection
	};
}

export type MountedBreak = ReturnType<typeof mountBreak>;
