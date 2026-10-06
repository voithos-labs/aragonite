// @vitest-environment jsdom
// Tab and Shift+Tab over a selection inside one block indent what binds them to an indent and do
// nothing elsewhere, the key taken either way so focus stays in the editor.
// Miss-analysis: the indent rows over a selection ran across blocks, and the prose Tab rows only
// ever pressed at a caret, so a selection inside one paragraph reached the literal tab unseen.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { activateDirectives } from '$lib/plugin';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';
import { cellAt } from '../table/mount-table';

beforeAll(() => {
	installLayoutStubs();
	activateDirectives();
});
afterEach(destroyMountedEditors);

const TAB = { key: 'Tab' };
const SHIFT_TAB = { key: 'Tab', shiftKey: true };

describe.each([
	['a paragraph', 'alpha\n', [0], 2, 4],
	['a heading', '# alpha\n', [0], 4, 6],
	["a quote's paragraph", '> alpha\n', [0, 0], 2, 4],
	['a directive leaf', '::toc alpha\n', [0], 8, 10]
])('over a selection in %s', (_name, source, path, start, end) => {
	it.each([
		['Tab', TAB],
		['Shift+Tab', SHIFT_TAB]
	])('%s changes nothing and is taken', async (_key, init) => {
		const mounted = mountEditor({ source });
		const el = surfaceAt(mounted, path);
		selectRange(el, start, end);

		const event = await pressKey(el, init);

		expect(mounted.source()).toBe(source);
		expect(event.defaultPrevented).toBe(true);
		expect(mounted.instance.getSelection()).toEqual({
			anchor: { path, offset: start },
			focus: { path, offset: end }
		});
	});
});

describe('over a selection where Tab already means something', () => {
	it.each([
		['Tab nests a list item', '- alpha\n- beta\n', [0, 1, 0], 1, 3, TAB, '- alpha\n  - beta\n'],
		[
			'Shift+Tab lifts a list item',
			'- alpha\n  - beta\n',
			[0, 0, 1, 0, 0],
			1,
			3,
			SHIFT_TAB,
			'- alpha\n- beta\n'
		],
		['Tab indents code lines', '```\nabc\ndef\n```\n', [0], 5, 12, TAB, '```\n\tabc\n\tdef\n```\n']
	])('%s', async (_name, source, path, start, end, init, after) => {
		const mounted = mountEditor({ source, presentationMode: 'source' });
		const el = surfaceAt(mounted, path);
		selectRange(el, start, end);

		const event = await pressKey(el, init);

		expect(mounted.source()).toBe(after);
		expect(event.defaultPrevented).toBe(true);
	});

	it('Tab in a table cell moves to the next cell', async () => {
		const source = '| A | B |\n| --- | --- |\n| one | two |\n';
		const mounted = mountEditor({ source });
		const cell = cellAt(mounted, 1, 0);
		selectRange(cell, 0, 2);

		await pressKey(cell, TAB);

		expect(mounted.source()).toBe(source);
		expect(document.activeElement).toBe(cellAt(mounted, 1, 1));
	});
});

describe('outside the rule', () => {
	it('Tab at a caret in a paragraph still types a tab', async () => {
		const mounted = mountEditor({ source: 'alpha\n' });
		const el = surfaceAt(mounted, [0]);
		placeCaret(el, 2);

		await pressKey(el, TAB);

		expect(mounted.source()).toBe('al\tpha\n');
	});

	// Reading mode edits nothing, and Tab there is how a keyboard reaches the next link.
	it('Tab over a selection in reading mode is left to the browser', async () => {
		const mounted = mountEditor({ source: 'alpha\n', presentationMode: 'reading' });
		const el = surfaceAt(mounted, [0]);
		selectRange(el, 2, 4);

		const event = await pressKey(el, TAB);

		expect(event.defaultPrevented).toBe(false);
	});
});
