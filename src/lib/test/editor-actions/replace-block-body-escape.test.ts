// A block lifted out of a quote or a list into a details body takes the body's escape, so a
// lifted closing tag stays text and the details block stays one block.
// Miss-analysis: the escape was tested on typing, joins and pastes, never on a replace a
// container's own Backspace makes in its parent.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '$lib';
import type { CstNode } from '$lib/core/nodes';
import { resetPluginPlatformForTests } from '$lib/testing';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import {
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus
} from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerDetailsKind();
});

/** The container at body index `inner` of the details block, whose parent is the details body. */
function mountInsideDetails(source: string, inner: number) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	const containerEdit = createContainerEditActions(harness.deps, controller);
	const details = () => harness.deps.doc.children[0];
	const detailsBundle = createStandardNestedActions(
		createBlockListState(details),
		makeNestedActionsDeps({
			index: 0,
			getNode: details,
			path: [0],
			parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
		})
	);
	const container = () => details().children![inner] as CstNode;
	const bundle = createStandardNestedActions(
		createBlockListState(container),
		makeNestedActionsDeps({
			index: inner,
			getNode: container,
			path: [0, inner],
			parent: { blockEdit: detailsBundle.blockEdit, focus: makeStubFocus(), containerEdit }
		})
	);
	return { doc: harness.deps.doc, bundle };
}

describe('Backspace at the start of a container holding a closing tag, inside details', () => {
	it.each([
		['a quote', '> </details>\n'],
		['a list', '- </details>\n']
	])('%s lifts the tag out escaped', async (_name, inner) => {
		const source = `<details>\n<summary>T</summary>\n\n${inner}\n</details>\n`;
		const h = mountInsideDetails(source, 1);

		await h.bundle.blockEdit.mergeWithPrevious(0);

		expect(serialize(h.doc)).toBe(
			'<details>\n<summary>T</summary>\n\n&lt;/details>\n\n</details>\n'
		);
		expect(parse(serialize(h.doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(describeConvergence(h.doc)).toBeNull();
	});
});
