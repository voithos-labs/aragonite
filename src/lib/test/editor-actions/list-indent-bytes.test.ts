// Miss-analysis: every indent test read markers, ids or the caret, never the bytes, so dropping
// the new sublist's rebuild (which no commit makes for it) lost the moved item and stayed green.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeListContextAt
} from '#lib/test/harness/editor-actions.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { CURSOR_START } from '#lib/block-component.js';

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
			source: '1. a\n   1. x\n5. b\n',
			bytes: '1. a\n   1. x\n   2. b\n'
		},
		{
			into: 'one of another delimiter it already holds',
			source: '1. a\n   1) x\n5. b\n',
			bytes: '1. a\n   1) x\n   2) b\n'
		},
		{
			into: 'a bullet sublist of another glyph it already holds',
			source: '- a\n  * x\n- b\n',
			bytes: '- a\n  * x\n  * b\n'
		}
	])('into $into', async ({ source, bytes }) => {
		expect(await indentSecondItem(source)).toBe(bytes);
	});
});

/** Shift+Tab on the first item of the sublist under item 0, with both lists mounted. */
async function liftFirstSubItem(source: string): Promise<string> {
	return (await liftLanding(source)).bytes;
}

/** `liftFirstSubItem`'s bytes, with the caret it lands. */
async function liftLanding(source: string) {
	const { deps, landings } = makeEditorActionsDeps(source);
	const item = () => deps.doc.children[0].children![0];
	const sublist = () => item().children![1];
	registerBlockListState(sublist(), makeBlockListState(sublist));
	registerBlockListState(item(), makeBlockListState(item));
	const { listContext } = makeListContextAt(deps, 0);

	expect(await listContext.promoteNestedItem(0, sublist(), 0)).toBe(true);
	expectParseConverged(deps.doc);
	const { leafPath, offset } = landings.at(-1)!;
	return { bytes: serialize(deps.doc), caret: { leafPath, offset } };
}

// The glyph and number follow the destination list; the spaces after them are the item's own
// bytes, which its text starts behind.
describe('a list move keeps the item’s own wider spacing', () => {
	it.each([
		{ into: 'a bullet sublist', source: '- a\n  - x\n-  b\n', bytes: '- a\n  - x\n  -  b\n' },
		{
			into: 'an ordered sublist',
			source: '1. a\n   1. x\n2.  b\n',
			bytes: '1. a\n   1. x\n   2.  b\n'
		}
	])('Tab into $into', async ({ source, bytes }) => {
		expect(await indentSecondItem(source)).toBe(bytes);
	});

	it('Shift+Tab out of a sublist of another glyph', async () => {
		expect(await liftFirstSubItem('- a\n  *  x\n')).toBe('- a\n-  x\n');
	});
});

// Miss-analysis: the one adoption row kept its sublist's delimiter and numbers, where a taken
// sibling left unstyled or unnumbered writes the bytes it read.
describe('Shift+Tab hands the siblings after the item to the sublist it holds', () => {
	it.each([
		{
			into: 'an ordered sublist',
			source: '1. a\n   1. x\n      1. q\n   7. y\n   9. z\n',
			bytes: '1. a\n2. x\n   1. q\n   2. y\n   3. z\n'
		},
		{
			into: 'one of another delimiter, wider spaced',
			source: '1. a\n   1. x\n      1) q\n   7.  y\n   9. z\n',
			bytes: '1. a\n2. x\n   1) q\n   2)  y\n   3) z\n'
		},
		{
			into: 'a bullet sublist of another glyph',
			source: '- a\n  - x\n    * q\n  - y\n  - z\n',
			bytes: '- a\n- x\n  * q\n  * y\n  * z\n'
		}
	])('into $into, each styled and numbered as it', async ({ source, bytes }) => {
		expect(await liftLanding(source)).toEqual({
			bytes,
			caret: { leafPath: [0, 1, 0], offset: CURSOR_START }
		});
	});
});
