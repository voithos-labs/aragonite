import { describe, it, expect, beforeEach } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import {
	makeEditorActionsDeps,
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubFocus
} from '../harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// A structural op that changes nothing (a rebound Enter → block.split on a
// single-line chrome leaf; a no-target merge) must not mint an undo entry or
// emit an edit event. The container path is the residue risk: its discard runs
// the full in-place mutate (spine unshare, per-scope publish, raw rebuild) then
// rolls it all back — so the doc must come out byte-identical.

const DETAILS = '<details>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';

describe('noop structural commit discards its snapshot', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerDetailsKind();
	});

	it('splitting a chrome leaf (container scope) mints no entry and leaves bytes untouched', async () => {
		const details = parse(DETAILS).children[0];
		expect(details.children?.[0].kind).toBe('details-summary'); // contextDependentKind chrome

		const { deps, events, getBlockIds } = makeEditorActionsDeps([details]);
		const controller = createUndoController(deps);
		const containerEdit = createContainerEditActions(deps, controller);

		const state = createBlockListState(() => deps.doc.children[0]);
		const bundle = createStandardNestedActions(state, {
			index: 0,
			get node() {
				return deps.doc.children[0];
			},
			path: [0],
			stickyColumn: makeStickyColumn(),
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus: makeStubFocus(),
				containerEdit
			}
		});

		const before = serialize(deps.doc);
		const beforeIds = [...getBlockIds()];
		const beforeChildIds = [...(deps.doc.children[0].childIds ?? [])];
		const edits: EditEvent[] = [];
		events.on('edit', (e) => edits.push(e));

		// Simulate a plugin that rebound the summary's Enter to block.split.
		await bundle.blockEdit.splitBlock(0, 3);

		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(edits).toHaveLength(0);
		expect(serialize(deps.doc)).toBe(before);
		expect(getBlockIds()).toEqual(beforeIds);
		expect(deps.doc.children[0].childIds ?? []).toEqual(beforeChildIds);
	});

	// Positive control: the discard is scoped to genuine no-ops. A real split
	// still mints exactly one entry and one event — a "discard everything"
	// regression fails here.
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
