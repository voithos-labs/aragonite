// A key pressed over a live range through the real dispatch and commits, on a document whose every
// container has a list state, as a mounted editor's does.

import type { SelectionEndpoint } from '$lib/selection/primitives';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';
import { makeBlockListState, makeTopHarness, type TopHarness } from '../../harness/editor-actions';
import { makeHandlers } from './typed-char-env';

export interface RangeKeyEnv {
	h: TopHarness;
}

export function rangeKeyEnv(source: string): RangeKeyEnv {
	const h = makeTopHarness(source);
	// Once a delete removes a container, its state falls back to the node it was built on.
	const mount = (path: number[]): void => {
		const node = blockNodeAt(h.deps.doc, path);
		node?.children?.forEach((_, i) => mount([...path, i]));
		if (node?.children) makeBlockListState(() => blockNodeAt(h.deps.doc, path) ?? node);
	};
	h.deps.doc.children.forEach((_, i) => mount([i]));
	return { h };
}

export function rangeHandlers(env: RangeKeyEnv) {
	const { h } = env;
	const handlerEnv = {
		doc: h.doc,
		deps: h.deps,
		events: h.events,
		selectionState: h.deps.selectionState,
		controller: h.controller,
		blockEdit: h.actions,
		caretMemory: h.deps.caretMemory
	};
	return makeHandlers(handlerEnv as never, [0]);
}

export function select(
	env: RangeKeyEnv,
	anchor: SelectionEndpoint,
	focus: SelectionEndpoint
): void {
	env.h.deps.selectionState.enterCrossBlock(anchor, focus);
}

export async function rangeKey(env: RangeKeyEnv, key: string): Promise<void> {
	await rangeHandlers(env).handleKeyDown(new KeyboardEvent('keydown', { key, cancelable: true }));
}

/** Every block a caret was put down in. */
export function placedPaths(env: RangeKeyEnv): number[][] {
	return env.h.landings.map((l) => [...l.leafPath]);
}

export const whole = (path: number[]): SelectionEndpoint => ({ path, wholeBlock: true });
export const at = (path: number[], offset: number): SelectionEndpoint => ({ path, offset });
export const cell = (path: number[], offset: number): SelectionEndpoint => ({
	path,
	offset,
	cellCoordinate: true
});
