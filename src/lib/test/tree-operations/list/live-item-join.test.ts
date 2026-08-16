// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus
} from '$lib/test/harness/editor-actions';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';

// B-F2: M1 was the one destructive join whose signature could not reach `cleanJoinedRaw`, so
// Enter-then-Backspace inside a list materialized the closer/opener pair the reader never saw,
// while the same pair at top level round-tripped.
// Miss-analysis: the live-join pins drive the two top-level merge primitives; M1 was covered only
// by mode-free structural cases, and the census that would have caught the gap
// (`lint/live-rewrite-verification.test.ts :: readsSlot`) is one-directional set equality.

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => __resetLiveJoinSeamCleanerForTests());

/** What Enter mid-`**bold**` leaves: the split rebalancer already closed and reopened the run. */
const SPLIT_BOLD = '- Some **bo**\n- **ld** text\n';

const rejoined = (mode: 'live' | undefined) => {
	const doc = parse(SPLIT_BOLD);
	const list = doc.children[0];
	mergeListItemIntoPrevious(list, list.children!.slice(), 1, undefined, mode, undefined);
	return serialize(doc);
};

describe('the list-item merge crosses the live join seam', () => {
	it('drops the runs the seam orphaned in live, and keeps them in every other mode', () => {
		expect(rejoined('live')).toBe('- Some **bold** text\n');
		expect(rejoined(undefined)).toBe('- Some **bo****ld** text\n');
	});

	// The primitive can only clean what its caller hands it the mode for, so the gesture is
	// pinned too: Backspace at a middle item's start is the one door into M1.
	it('the middle-item Backspace hands the mode down', async () => {
		const { deps } = makeEditorActionsDeps(parse(SPLIT_BOLD), { presentationMode: 'live' });
		const controller = createUndoController(deps);
		const containerEdit = createContainerEditActions(deps, controller);
		const getNode = () => deps.doc.children[0];
		const state = makeBlockListState(getNode);
		registerBlockListState(getNode(), state);
		const bundle = createStandardNestedActions(
			state,
			makeNestedActionsDeps({
				index: 0,
				getNode,
				path: [0],
				getPresentationMode: deps.getPresentationMode,
				parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
			})
		);

		await bundle.blockEdit.mergeWithPrevious(1);

		expect(serialize(deps.doc)).toBe('- Some **bold** text\n');
	});
});
