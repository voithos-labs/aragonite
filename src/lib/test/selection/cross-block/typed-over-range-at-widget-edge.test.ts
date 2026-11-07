// @vitest-environment jsdom
// Text typed over a range across blocks replaces it however it arrives, with the range's end at
// either edge of a block holding only a picture, where the caret sits in no text node.
// Miss-analysis: every typed-over-range row ended the range in text, so the block's own keydown
// write beside a widget, which takes the key before the range sees it, was never under a range.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { insertBy, type InsertionRoute } from '#lib/test/harness/insertion-routes.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const PIC = '![pic](/test-fixtures/sample.png)';
const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

// A spellcheck replacement aims at its own word, never the range; the harness composes before the
// removal lands, as no IME does, so a composition is the e2e spec's.
const ROUTES: InsertionRoute[] = [
	'hardware key',
	'soft key',
	'soft key after an unnamed keydown',
	'paste'
];

// Each range with the bytes typing `Z` over it leaves.
const RANGES: [
	name: string,
	source: string,
	from: SelectionPoint,
	to: SelectionPoint,
	left: string
][] = [
	[
		'to the end of a picture paragraph',
		`alpha\n\nbeta\n\n${PIC}\n`,
		at([0], 5),
		at([2], PIC.length),
		'alphaZ\n'
	],
	[
		'to the start of a picture paragraph',
		`alpha\n\nbeta\n\n${PIC}\n`,
		at([0], 5),
		at([2], 0),
		`alphaZ${PIC}\n`
	],
	[
		'over the whole document, ending on a picture',
		`alpha\n\nbeta\n\n${PIC}\n`,
		at([0], 0),
		at([2], PIC.length),
		'Z\n'
	],
	[
		'to the end of a picture in a list item',
		`alpha\n\n- ${PIC}\n`,
		at([0], 5),
		at([1, 0, 0], PIC.length),
		'alphaZ\n'
	],
	[
		'to the start of a picture in a list item',
		`alpha\n\n- ${PIC}\n`,
		at([0], 5),
		at([1, 0, 0], 0),
		`alphaZ${PIC}\n`
	]
];

describe('text typed over a range ending at a picture’s edge', () => {
	for (const [name, source, from, to, left] of RANGES) {
		for (const route of ROUTES) {
			it(`by ${route}, ${name}, replaces the range`, async () => {
				const editor = mountEditor({ source });
				await editor.instance.setSelection({ anchor: from, focus: to });
				await editor.settle();
				await insertBy(route, surfaceAt(editor, to.path), 'Z');
				expect(editor.source()).toBe(left);
				const after = editor.instance.getSelection();
				expect(after?.anchor).toEqual(after?.focus);
			});
		}
	}
});
