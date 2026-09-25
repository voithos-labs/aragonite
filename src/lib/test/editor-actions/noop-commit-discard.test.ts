import { describe, it, expect, beforeEach } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { findMergeTarget } from '$lib/schema/merge-rules';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import {
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus,
	makeTopHarness
} from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// A structural edit that changes nothing must push no undo entry and emit no edit event.
// The container path is the one that can leave traces: its discard runs the full in-place
// mutate then rolls it back, so the document must come out byte-identical.

const DETAILS = '<details>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';

describe('noop structural commit discards its snapshot', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerDetailsKind();
	});

	it('splitting a chrome leaf (container scope) creates no entry and leaves bytes untouched', async () => {
		const details = parse(DETAILS).children[0];
		expect(details.children?.[0].kind).toBe('details-summary');

		const { deps, events, getBlockIds } = makeEditorActionsDeps([details]);
		const controller = createUndoController(deps);
		const containerEdit = createContainerEditActions(deps, controller);

		const state = createBlockListState(() => deps.doc.children[0]);
		const bundle = createStandardNestedActions(
			state,
			makeNestedActionsDeps({
				index: 0,
				getNode: () => deps.doc.children[0],
				path: [0],
				parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
			})
		);

		const before = serialize(deps.doc);
		const beforeIds = [...getBlockIds()];
		const beforeChildIds = [...(deps.doc.children[0].childIds ?? [])];
		const edits: EditEvent[] = [];
		events.on('edit', (e) => edits.push(e));

		// A plugin that rebound the summary's Enter to block.split.
		await bundle.blockEdit.splitBlock(0, 3);

		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(edits).toHaveLength(0);
		expect(serialize(deps.doc)).toBe(before);
		expect(getBlockIds()).toEqual(beforeIds);
		expect(deps.doc.children[0].childIds ?? []).toEqual(beforeChildIds);
	});

	// Control: a "discard everything" regression fails here.
	it('a real paragraph split still creates one undo entry and one edit event', async () => {
		const h = makeTopHarness('hello world\n');

		await h.actions.splitBlock(0, 5);

		expect(h.deps.undoManager.getStacks().undo).toHaveLength(1);
		expect(h.edits.filter((e) => e.op === 'split')).toHaveLength(1);
		expect(h.deps.doc.children).toHaveLength(2);
	});
});

// The rule M1 middle-item merge finds no target when the previous item's deepest leaf has no
// editable text, and that no-op must discard like its block-edit-core sibling.
describe('no-target list middle-item merge discards its commit', () => {
	it('Backspace above an opaque prev leaf creates no entry and no merge event', async () => {
		const doc = parse('- ```\n  code\n  ```\n- text\n');
		const list = doc.children[0];
		// So the case can fail: a reachable prose leaf would merge and legitimately commit.
		expect(list.children?.[0].children?.[0].kind).toBe('fencedCode');
		expect(findMergeTarget(list.children![0])).toBeNull();

		const { deps, events } = makeEditorActionsDeps([list]);
		const controller = createUndoController(deps);
		const containerEdit = createContainerEditActions(deps, controller);
		const state = createBlockListState(() => deps.doc.children[0]);
		const bundle = createStandardNestedActions(
			state,
			makeNestedActionsDeps({
				index: 0,
				getNode: () => deps.doc.children[0],
				path: [0],
				parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
			})
		);

		const before = serialize(deps.doc);
		const beforeChildIds = [...(deps.doc.children[0].childIds ?? [])];
		const edits: EditEvent[] = [];
		events.on('edit', (e) => edits.push(e));

		await bundle.blockEdit.mergeWithPrevious(1);

		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(edits).toHaveLength(0);
		expect(serialize(deps.doc)).toBe(before);
		expect(deps.doc.children[0].childIds ?? []).toEqual(beforeChildIds);
	});
});
