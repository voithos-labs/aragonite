// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import {
	createStandardNestedActions,
	type NestedActionsBundle
} from '$lib/editor-actions/nested/nested-actions';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubFocus
} from '$lib/test/harness/editor-actions';
import type { CstNode, Document } from '$lib/core/nodes';

// The mint is not the only way into `- x\n  - `: emptying the one nested item's paragraph lands
// the same bytes from the other direction, and the write is two levels below the list that owes
// the separating line. The chain rebuild every commit runs is where both meet.
//
// Miss-analysis: the ancestry rebuild's seam ask only ever FOLDS, so a slot whose reload reads as
// a different kind than the block above it fell through with no verdict, and nothing asserted that
// a container's rebuilt opener still means what the tree says it means.

function nodeAt(doc: Document, path: number[]): CstNode {
	let node = doc.children[path[0]];
	for (const i of path.slice(1)) node = node.children![i];
	return node;
}

/** The action bundle owning the container at `path`, built down from the document root. */
function bundleAt(doc: Document, root: NestedActionsBundle, path: number[]): NestedActionsBundle {
	let bundle = root;
	for (let depth = 1; depth <= path.length; depth++) {
		const here = path.slice(0, depth);
		const getNode = () => nodeAt(doc, here);
		const state = makeBlockListState(getNode);
		registerBlockListState(getNode(), state);
		bundle = createStandardNestedActions(
			state,
			makeNestedActionsDeps({
				index: here[here.length - 1],
				getNode,
				path: here,
				parent: bundle
			})
		);
	}
	return bundle;
}

/** Empty the leaf at `leafPath` through the door a keystroke uses, and report the bytes. */
async function emptyLeaf(source: string, leafPath: number[]): Promise<Document> {
	const { deps } = makeEditorActionsDeps(parse(source));
	const controller = createUndoController(deps);
	const rootBundle: NestedActionsBundle = {
		blockEdit: createBlockEditActions(deps, controller),
		focus: makeStubFocus(),
		containerEdit: createContainerEditActions(deps, controller)
	};
	const container = bundleAt(deps.doc, rootBundle, leafPath.slice(0, -1));
	await container.blockEdit.updateBlockContent(leafPath[leafPath.length - 1], '\n', 0);
	return deps.doc;
}

describe('emptying the only nested item separates the sublist', () => {
	it('mints the line the emptied marker can no longer do without', async () => {
		const doc = await emptyLeaf('- x\n  - y\n', [0, 0, 1, 0, 0]);

		expect(serialize(doc)).toBe('- x\n\n  - \n');
		expect(describeConvergence(doc)).toBeNull();
	});

	// The same shape one level out: `siblings` is the document's own array there, which the
	// chain walk reaches with no owner above it.
	it('reaches a top-level list under a paragraph', async () => {
		const doc = await emptyLeaf('a\n- y\n', [1, 0, 0]);

		expect(serialize(doc)).toBe('a\n\n- \n');
		expect(describeConvergence(doc)).toBeNull();
	});

	// The decline: a sibling still carries content, so the list's first line interrupts on its
	// own and the tight list stays tight.
	it('leaves a list whose first item still has content alone', async () => {
		const doc = await emptyLeaf('- x\n  - y\n  - z\n', [0, 0, 1, 1, 0]);

		expect(serialize(doc)).toBe('- x\n  - y\n  - \n');
		expect(describeConvergence(doc)).toBeNull();
	});
});
