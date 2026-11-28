// @vitest-environment jsdom
// Typing into an empty list item's first row, over its own quote or sublist, keeps the list tight
// as a paste there does; where the text and the block below would read as one, both keep the line.
// Miss-analysis: the empty-item rows pasted alone, so no row saw a typed fill give the block below
// a blank line the item's marker line never held.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	mountCase,
	pasteGesture,
	placeRange,
	typeGesture,
	type Editor
} from '../../range-laws/gestures';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type How = 'key' | 'composition' | 'paste';

async function filled(source: string, path: number[], how: How): Promise<string> {
	await destroyMountedEditors();
	const editor: Editor = mountCase(source, 'source');
	await editor.settle();
	await placeRange(editor, { anchor: { path, offset: 0 }, focus: { path, offset: 0 } });
	if (how === 'paste') await pasteGesture(editor, { 'text/plain': 'Q' }, 'key');
	else
		await typeGesture(editor, { text: 'Q', route: how === 'key' ? 'hardware key' : 'composition' });
	return editor.source();
}

const ROWS: [name: string, source: string, path: number[], after: string][] = [
	['over its own quote', '- \n  > b\n', [0, 0, 0], '- Q\n  > b\n'],
	['over its own sublist', '- \n  - b\n', [0, 0, 0], '- Q\n  - b\n'],
	['a second item over its own quote', '- a\n- \n  > b\n', [0, 1, 0], '- a\n- Q\n  > b\n'],
	['over a paragraph it would join', '- \n  b\n', [0, 0, 0], '- Q\n\n  b\n']
];

describe('a fill of an empty item’s first row', () => {
	for (const [name, source, path, after] of ROWS)
		for (const how of ['key', 'composition', 'paste'] as const)
			it(`${name}, by ${how}`, async () => {
				expect(await filled(source, path, how)).toBe(after);
			});
});
