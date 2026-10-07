// @vitest-environment jsdom
// Enter in an empty item that holds a sublist, a paragraph and a second sublist leaves the list with
// the item's children in the order they read, the new paragraph where the item's line was.
// Miss-analysis: every exit fixture gave the empty item one kind of child, so none read a sublist
// item against a paragraph after it.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const ENTER = { key: 'Enter' };

// Each shape presses Enter at the end of `a`, whose children go to the new empty item, then Enter
// in that item.
const SHAPES: [shape: string, source: string, aPath: number[], exited: string][] = [
	[
		'a top-level list',
		'- z\n- a\n  - x\n\n  p\n\n  - y\n- b\n',
		[0, 1, 0],
		'- z\n- a\n\n\n- x\n\np\n\n- y\n- b\n'
	],
	[
		'a list in a quote',
		'> - z\n> - a\n>   - x\n>\n>   p\n>\n>   - y\n> - b\n',
		[0, 0, 1, 0],
		'> - z\n> - a\n>\n>\n> - x\n>\n> p\n>\n> - y\n> - b\n'
	],
	// One level down Enter lifts the item instead, which keeps its children under it.
	[
		'a sublist',
		'- o\n  - z\n  - a\n    - x\n\n    p\n\n    - y\n  - b\n',
		[0, 0, 1, 1, 0],
		'- o\n  - z\n  - a\n- \n  - x\n\n  p\n\n  - y\n  - b\n'
	]
];

describe('Enter in an empty item keeps its children in the order they read', () => {
	for (const mode of ['source', 'live'] as const) {
		for (const [shape, source, aPath, exited] of SHAPES) {
			it(`${mode}: in ${shape}`, async () => {
				mounted = mountEditor({ source, presentationMode: mode });
				await pressKeyAt(mounted, aPath, 1, ENTER);
				const emptyPath = aPath.with(-2, aPath.at(-2)! + 1);
				await pressKeyAt(mounted, emptyPath, 0, ENTER);

				expect(mounted.source()).toBe(exited);
			});
		}

		it(`${mode}: at a list's first item`, async () => {
			mounted = mountEditor({ source: '- \n  - x\n\n  p\n\n  - y\n- b\n', presentationMode: mode });
			await pressKeyAt(mounted, [0, 0, 0], 0, ENTER);

			expect(mounted.source()).toBe('\n- x\n\np\n\n- y\n- b\n');
		});
	}
});
