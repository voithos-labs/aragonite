import { describe, it, expect, beforeEach } from 'vitest';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { parse } from '$lib/core/parser';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import {
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubContainerEdit,
	makeStubFocus,
	makeTopHarness
} from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

// Forward-Delete at the end of a collapsed summary must exit past the container rather
// than dead-end on the unmounted body (refAt(i+1) no-op) — a focus move, no mutation.

const CLOSED_DETAILS = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';
const OPEN_DETAILS = '<details open>\n<summary>Sum</summary>\n\nBody\n\n</details>\n';

function nestedFor(node: CstNode) {
	const state = createBlockListState(() => node);
	const parent = {
		blockEdit: makeStubBlockEdit(),
		focus: makeStubFocus(),
		containerEdit: makeStubContainerEdit()
	};
	const bundle = createStandardNestedActions(
		state,
		makeNestedActionsDeps({ index: 4, getNode: () => node, path: [4], parent })
	);
	return { bundle, parent };
}

describe('collapsed container forward-merge exit', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerDetailsKind();
	});

	it('mergeWithNext from a collapsed summary exits past the container without mutating', async () => {
		const node = parse(CLOSED_DETAILS).children[0];
		expect(node.children?.length).toBe(2);
		const { bundle, parent } = nestedFor(node);

		await bundle.blockEdit.mergeWithNext(0);

		expect(parent.focus.moveFocus).toHaveBeenCalledWith(5, 'start', { append: false });
		expect(parent.containerEdit.commitContainer).not.toHaveBeenCalled();
		expect(parent.blockEdit.mergeWithNext).not.toHaveBeenCalled();
		expect(node.children?.length).toBe(2);
	});

	it('an open container is not treated as an exit (collapse-gated)', async () => {
		const node = parse(OPEN_DETAILS).children[0];
		const { bundle, parent } = nestedFor(node);

		await bundle.blockEdit.mergeWithNext(0);

		expect(parent.focus.moveFocus).not.toHaveBeenCalledWith(5, 'start');
	});

	// Past the document end the root focus action mints an empty paragraph unless
	// `{ append: false }` stops it. Driven through the REAL action; the stub is position-blind.
	it('mergeWithNext from a collapsed summary that is the last block appends nothing', async () => {
		const details = parse(CLOSED_DETAILS).children[0];
		const harness = makeTopHarness([details]);
		const realFocus = createFocusActions(harness.deps, harness.controller);

		const state = createBlockListState(() => details);
		const bundle = createStandardNestedActions(
			state,
			makeNestedActionsDeps({
				index: 0,
				getNode: () => details,
				path: [0],
				parent: {
					blockEdit: makeStubBlockEdit(),
					focus: realFocus,
					containerEdit: makeStubContainerEdit()
				}
			})
		);

		await bundle.blockEdit.mergeWithNext(0);

		expect(harness.doc.children).toHaveLength(1);
		expect(harness.edits.filter((e) => e.op === 'appendBlock')).toHaveLength(0);
	});
});
