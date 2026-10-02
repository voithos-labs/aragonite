// Miss-analysis: every indent test read markers, ids or the caret, never the bytes, so dropping
// the new sublist's rebuild (which no commit makes for it) lost the moved item and stayed green.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

/** Tab on item 1 of the top-level list, with the item above and any sublist it holds mounted. */
async function indentSecondItem(source: string): Promise<string> {
	const { deps } = makeEditorActionsDeps(source);
	const prevItem = () => deps.doc.children[0].children![0];
	registerBlockListState(prevItem(), makeBlockListState(prevItem));
	const sublist = () => prevItem().children![1];
	if (sublist()?.kind === 'list') registerBlockListState(sublist(), makeBlockListState(sublist));
	const { listContext } = makeListContextAt(deps, 0);

	expect(await listContext.indentItem(1)).toBe(true);
	expectParseConverged(deps.doc);
	return serialize(deps.doc);
}

describe('indentItem writes the moved item under the item above', () => {
	it.each([
		{ into: 'a new bullet sublist', source: '- a\n- b\n', bytes: '- a\n  - b\n' },
		{
			into: 'a new ordered sublist',
			source: '1. a\n2. b\n3. c\n',
			bytes: '1. a\n   1. b\n2. c\n'
		},
		{
			into: 'a sublist it already holds',
			source: '- a\n  - x\n- b\n',
			bytes: '- a\n  - x\n  - b\n'
		},
		{
			into: 'an ordered sublist it already holds',
			source: '1. a\n   1. x\n2. b\n',
			bytes: '1. a\n   1. x\n   2. b\n'
		}
	])('into $into', async ({ source, bytes }) => {
		expect(await indentSecondItem(source)).toBe(bytes);
	});
});
