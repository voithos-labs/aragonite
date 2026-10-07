// @vitest-environment jsdom
// Backspace at a middle item's start rewrites its marker line only: its text joins the line above,
// and every line under it keeps its bytes and reads where it now stands, as a reload reads it.
// Miss-analysis: every merge fixture gave the merged item no children, or one sublist, so nothing
// held a paragraph after a sublist, where the merge moved the paragraph above the sublist's items.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import type { CstNode, Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';

beforeAll(installLayoutStubs);

type Seam = { getDocument(): Document };
let mounted: MountedEditor<Seam>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

/** A tree as its kinds and bytes, what a reload would compare. */
const shapeOf = (nodes: readonly CstNode[]): unknown =>
	nodes.map((node) => ({
		kind: node.kind,
		trivia: node.leadingTrivia,
		raw: node.raw,
		children: node.children && shapeOf(node.children)
	}));

const MERGES: [shape: string, source: string, at: number[], merged: string][] = [
	[
		'a sublist then a paragraph',
		'- i0\n  - i1\n    - i2\n  - i3\n    - i4\n\n    p5\n',
		[0, 0, 1, 1, 0],
		'- i0\n  - i1\n    - i2i3\n    - i4\n\n    p5\n'
	],
	[
		'a paragraph then a sublist',
		'- a\n  - x\n- b\n\n  more\n\n  - y\n',
		[0, 1, 0],
		'- a\n  - xb\n\n  more\n\n  - y\n'
	]
];

describe('a merge whose lines would read outside the list', () => {
	// `a`'s text starts four columns in, so `more` would read as a paragraph after the list.
	it('declines: the bytes stay and the caret moves to the end of the item above', async () => {
		const source = '-   a\n- b\n\n  more\n';
		mounted = mountEditor<Seam>({ source });
		await pressKeyAt(mounted, [0, 1, 0], 0, { key: 'Backspace' });

		expect(mounted.source()).toBe(source);
		expect(mounted.instance.getSelection()?.focus).toEqual({ path: [0, 0, 0], offset: 1 });
	});
});

describe('Backspace at a middle item rewrites only its marker line', () => {
	for (const [shape, source, at, merged] of MERGES) {
		it(`an item holding ${shape} leaves those lines where they stand`, async () => {
			mounted = mountEditor<Seam>({ source });
			await pressKeyAt(mounted, at, 0, { key: 'Backspace' });

			expect(mounted.source()).toBe(merged);
			expect(shapeOf(mounted.instance.__test.getDocument().children)).toEqual(
				shapeOf(parse(merged).children)
			);
		});
	}
});
