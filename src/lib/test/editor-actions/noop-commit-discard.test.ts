import { describe, it, expect, beforeEach } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { findMergeTarget } from '$lib/schema/merge-rules';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import {
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus
} from '../harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// A structural op that changes nothing must mint no undo entry and emit no edit event.
// The container path is the residue risk: its discard runs the full in-place mutate
// then rolls it back, so the doc must come out byte-identical.

const DETAILS = '<details>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';

describe('noop structural commit discards its snapshot', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerDetailsKind();
	});

	it('splitting a chrome leaf (container scope) mints no entry and leaves bytes untouched', async () => {
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

	// Positive control: a "discard everything" regression fails here.
	it('a real paragraph split still mints one undo entry and one edit event', async () => {
		const doc = parse('hello world\n');
		const { deps, events } = makeEditorActionsDeps(doc.children);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const edits: EditEvent[] = [];
		events.on('edit', (e) => edits.push(e));

		await actions.splitBlock(0, 5);

		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
		expect(edits.filter((e) => e.op === 'split')).toHaveLength(1);
		expect(deps.doc.children).toHaveLength(2);
	});
});

// The M1 middle-item merge finds no target when the previous item's deepest leaf is
// opaque, and that no-op must discard like its block-edit-core sibling.
describe('no-target list middle-item merge discards its commit', () => {
	it('Backspace above an opaque prev leaf mints no entry and no merge event', async () => {
		const doc = parse('- ```\n  code\n  ```\n- text\n');
		const list = doc.children[0];
		// RED ≠ GREEN: a reachable prose leaf would merge and legitimately commit.
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
