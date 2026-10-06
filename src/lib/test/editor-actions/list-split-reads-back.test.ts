// @vitest-environment jsdom
// Miss-analysis: every list split row checked the bytes, and none read the new item back, so an
// item built over a leading space or indented code kept a marker its reload widens.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { metadataOf, type Document, type ListItemMetadata } from '$lib/core/nodes';
import type { PresentationMode } from '$lib/presentation-mode';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { rebalanceLiveSplit } from '$lib/components/blocks/text/live-split-rebalance';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	registerLiveSplitRebalancer,
	__resetLiveJoinSeamCleanerForTests,
	__resetLiveSplitRebalancerForTests
} from '$lib/schema/inline-construct-policy';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '$lib/test/harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';
import { describeConvergence } from '../harness/parse-converged';

beforeEach(() => {
	registerLiveSplitRebalancer(rebalanceLiveSplit);
	registerLiveJoinSeamCleaner(cleanLiveJoinSeam);
});
afterEach(() => {
	__resetLiveSplitRebalancerForTests();
	__resetLiveJoinSeamCleanerForTests();
});

/** Enter at `offset` in the first item's first block, through the list's own split. */
async function enterInFirstItem(
	source: string,
	offset: number,
	mode: PresentationMode
): Promise<Document> {
	const list = parse(source).children[0];
	const { deps } = makeEditorActionsDeps([list], { reading: fixtureReading({}, mode) });
	const item = list.children![0];
	const ids = item.children!.map((_, i) => `child-${i}`);
	const liveItem = () => deps.doc.children[0].children![0];
	registerBlockListState(item, makeBlockListState(liveItem, ids) as never);
	const { listContext } = makeListContextAt(deps, 0, { ids: ['item-0'] });

	await listContext.splitItemAtOffset(0, 0, offset);
	return deps.doc;
}

const secondItem = (doc: Document): Partial<ListItemMetadata> =>
	metadataOf(doc.children[0].children![1], 'listItem');

describe('Enter in a list item: the new item holds what its bytes read as', () => {
	it.each<[string, string, number, PresentationMode, string, Partial<ListItemMetadata>]>([
		['a space after the cut, source', '- a b\n', 1, 'source', '- a\n-  b\n', { marker: '-  ' }],
		['a space after the cut, live', '- a b\n', 1, 'live', '- a\n-  b\n', { marker: '-  ' }],
		[
			'a space inside a bold run, live',
			'- **bo ld**\n',
			4,
			'live',
			'- **bo**\n-  **ld**\n',
			{ marker: '-  ' }
		],
		['a number that grows a digit', '9. a b\n', 1, 'source', '9. a\n10.  b\n', { marker: '10.  ' }],
		[
			'a to-do whose first half reads as text behind its box, live',
			'- [ ] # **bo ld**\n',
			6,
			'live',
			'- [ ] # **bo**\n- [ ]  **ld**\n',
			{ taskMarker: '[ ]  ' }
		]
	])('%s', async (_what, source, offset, mode, expected, marker) => {
		const doc = await enterInFirstItem(source, offset, mode);

		expect(serialize(doc)).toBe(expected);
		expect(secondItem(doc)).toMatchObject(marker);
		expect(describeConvergence(doc)).toBeNull();
	});
});
