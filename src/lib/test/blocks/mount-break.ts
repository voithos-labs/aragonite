// ThematicBreakBlock mounted as the middle block of a three-block document — the reference
// whole-block-focus kind, with the editing host it publishes and the stubs its wiring reads.

import { mount, unmount, flushSync } from 'svelte';
import { vi } from 'vitest';
import ThematicBreakBlock from '$lib/components/blocks/ThematicBreakBlock.svelte';
import type { EditorServices } from '$lib/editor-keys';
import type { PresentationMode } from '$lib/presentation-mode';
import { WHOLE_BLOCK_INPUT_ATTR } from '$lib/editor-actions/whole-block-focus-surface';
import { parse } from '$lib/core/parser';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { makeStubBlockEdit, makeStubFocus } from '../harness/editor-actions';
import { editorMountContext } from '../harness/mount-context';

export const BREAK_RAW = '---\n';
export const BREAK_INDEX = 1;

export function mountBreak(presentationMode: PresentationMode = 'source') {
	const doc = parse(`a\n\n${BREAK_RAW}\nb\n`);
	// Kind dispatch reads the node, so a fixture drift would silently mount this component
	// over a paragraph and leave every assertion still passing.
	if (doc.children[BREAK_INDEX].kind !== 'thematicBreak') {
		throw new Error(`fixture drift: block ${BREAK_INDEX} is ${doc.children[BREAK_INDEX].kind}`);
	}
	const blockEdit = makeStubBlockEdit();
	const focus = makeStubFocus();
	const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
	const reorder = { nudgeReorderUnit: vi.fn() } as unknown as EditorServices['reorder'];
	const selection = createSelectionState();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ThematicBreakBlock, {
		target,
		props: { node: doc.children[BREAK_INDEX], index: BREAK_INDEX, myPath: [BREAK_INDEX] },
		context: editorMountContext({
			blockEdit,
			focus,
			history,
			doc: { doc: () => doc },
			services: { reorder, selection },
			policies: { presentationMode: () => presentationMode }
		})
	});
	flushSync();
	const el = target.querySelector('.thematic-break-block') as HTMLElement;
	return {
		instance,
		el,
		host: el.querySelector(`[${WHOLE_BLOCK_INPUT_ATTR}]`) as HTMLElement,
		blockEdit,
		focus,
		history,
		reorder,
		selection,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

export type MountedBreak = ReturnType<typeof mountBreak>;
