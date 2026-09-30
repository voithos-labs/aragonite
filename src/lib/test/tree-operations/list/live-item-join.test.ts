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
import { fixtureReading } from '../../harness/fixture-grammar';
import { createSharingState } from '$lib/tree-operations/sharing';

// In live mode a list-item merge drops the `**` pair a split left behind, as a top-level join does.
// Miss-analysis: the list-item merge was tested only in mode-free cases, never in live mode.

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => __resetLiveJoinSeamCleanerForTests());

/** What Enter mid-`**bold**` leaves: the split rebalancer already closed and reopened the run. */
const SPLIT_BOLD = '- Some **bo**\n- **ld** text\n';

const rejoined = (mode: 'live' | undefined) => {
	const doc = parse(SPLIT_BOLD);
	const list = doc.children[0];
	mergeListItemIntoPrevious(
		list,
		list.children!.slice(),
		1,
		createSharingState(),
		fixtureReading({}, mode)
	);
	return serialize(doc);
};

describe('the list-item merge crosses the live join', () => {
	it('drops the runs the join orphaned in live, and keeps them in every other mode', () => {
		expect(rejoined('live')).toBe('- Some **bold** text\n');
		expect(rejoined(undefined)).toBe('- Some **bo****ld** text\n');
	});

	// The merge cleans up only when its caller passes the mode, so the Backspace path is driven too.
	// Hand-built, since under jsdom `makeNestedHarness`'s block-list state is an orphaned `$effect`.
	it('the middle-item Backspace hands the mode down', async () => {
		const { deps } = makeEditorActionsDeps(parse(SPLIT_BOLD), {
			reading: fixtureReading({}, 'live')
		});
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
				reading: deps.reading,
				parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
			})
		);

		await bundle.blockEdit.mergeWithPrevious(1);

		expect(serialize(deps.doc)).toBe('- Some **bold** text\n');
	});
});
