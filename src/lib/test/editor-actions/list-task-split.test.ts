// Miss-analysis: the task-aware reader reached typed writes and merges but not the list split, and
// the shape property keeps list-item bodies out of its split gesture, so no case split a to-do.

import { describe, it, expect } from 'vitest';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { Document } from '$lib/core/nodes';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '$lib/test/harness/editor-actions';
import { describeConvergence } from '../harness/parse-converged';

async function splitFirstItem(source: string, offset: number): Promise<Document> {
	const list = parse(source).children[0];
	const { deps } = makeEditorActionsDeps([list]);
	const liveItem = () => deps.doc.children[0].children![0];
	registerBlockListState(list.children![0], makeBlockListState(liveItem, ['para']) as never);
	const { listContext } = makeListContextAt(deps, 0, { ids: ['item-0'] });

	await listContext.splitItemAtOffset(0, 0, offset);
	return deps.doc;
}

describe('a list split reads each half as the text after a task marker', () => {
	it.each([
		['inside `# adwada`', '- [ ] # adwada\n', 4, '- [ ] # ad\n- [ ] wada\n'],
		['before the `#` of `ab# cd`', '- [ ] ab# cd\n', 2, '- [ ] ab\n- [ ] # cd\n']
	])('Enter %s keeps both to-dos paragraphs', async (_what, source, offset, expected) => {
		const doc = await splitFirstItem(source, offset);

		expect(serialize(doc)).toBe(expected);
		const firstChildKinds = doc.children[0].children!.map((item) => item.children![0].kind);
		expect(firstChildKinds).toEqual(['paragraph', 'paragraph']);
		expect(describeConvergence(doc)).toBeNull();
	});
});
