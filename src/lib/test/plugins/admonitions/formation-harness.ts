/**
 * Headless driver for alert formation from inside a blockquote: a container action
 * bundle at any depth over the real editor-actions stack, plus the typing loop the
 * formation suites share. Coordinates are doc-absolute, so one document-level undo
 * controller and container-edit serve every nesting level.
 */

import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import {
	createStandardNestedActions,
	type NestedActionsBundle
} from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus
} from '$lib/test/harness/editor-actions';

export function containerAt(source: string, path: number[]) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	const containerEdit = createContainerEditActions(harness.deps, controller);
	const getNode = () =>
		path.reduce<CstNode>(
			(node, index) => (node.children ?? harness.deps.doc.children)[index],
			harness.deps.doc as unknown as CstNode
		);
	const parentFocus = makeStubFocus();
	const bundle = createStandardNestedActions(
		createBlockListState(getNode),
		makeNestedActionsDeps({
			index: path[path.length - 1],
			getNode,
			path,
			parent: { blockEdit: makeStubBlockEdit(), focus: parentFocus, containerEdit }
		})
	);
	return {
		...harness,
		controller,
		history: createHistoryActions(harness.deps, controller),
		bundle,
		getNode,
		parentFocus
	};
}

/** Type `suffix` one character at a time into the container's leaf at `innerIndex`. */
export async function typeSlowly(
	bundle: NestedActionsBundle,
	innerIndex: number,
	prefix: string,
	suffix: string
): Promise<void> {
	let text = prefix;
	for (const char of suffix) {
		text += char;
		await bundle.blockEdit.updateBlockContent(innerIndex, `${text}\n`, text.length - 1);
	}
}
