// @vitest-environment jsdom
// The guide's document recipe runs as an author copies it: the outline lists every heading at its
// level, inside a list and a quote and underlined; footnote numbers follow first appearance; and
// the outline's text check never drops a heading the walk would find.
// Miss-analysis: the recipe was prose no row ran; the rows used toy keys.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { grammar } from '#lib/components/editor-root/headless-grammar.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import type { Block } from '#lib/schema/doc-view.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { FLUSH_JOIN_DOCUMENTS, SMALL_DOCUMENTS } from '../../behavior/corpus';
import { contents, headingsIn, noteNumbers } from '../fixtures/reading-recipe';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const DOC = [
	'[[toc]]',
	'# One',
	'Setext\n======',
	'- # In a list',
	'> ## In a quote',
	'A ref[^b] and[^a] again[^b].',
	''
].join('\n\n');

describe("the guide's recipe", () => {
	it('lists every heading at its level, and follows a heading key', async () => {
		const m = mountEditor({ source: DOC, plugins: [contents] });
		await m.settle();
		const rows = () =>
			[...m.target.querySelectorAll('nav > div')].map((row) => [
				(row as HTMLElement).dataset.level,
				row.textContent
			]);
		expect(rows()).toEqual([
			['1', 'One'],
			['1', 'Setext'],
			['1', 'In a list'],
			['2', 'In a quote']
		]);
		typeInto(surfaceAt(m, [1]), '# OneX');
		await m.settle();
		expect(rows()[0]).toEqual(['1', 'OneX']);
	});

	it('numbers references by first appearance', async () => {
		const m = mountEditor<EditorTestSurface>({ source: DOC, plugins: [noteNumbers] });
		await m.settle();
		const path = [5];
		const node = blockNodeAt(m.instance.__test.getDocument(), path)!;
		const marks = m.instance.__test.getDecorationEngine().paintOf(node, path).marks;
		expect(marks.map(({ dec }) => [dec.class, dec.attrs?.['data-note']])).toEqual([
			['note-ref', '1'],
			['note-ref', '2'],
			['note-ref', '1']
		]);
	});

	const corpus = Object.entries({ ...SMALL_DOCUMENTS, ...FLUSH_JOIN_DOCUMENTS, recipe: DOC });
	// The same key with no text check: every block walked.
	const unchecked = (block: Block) => {
		let lines = '';
		for (const inside of block.walk()) {
			if (inside.type.name !== 'heading' && inside.type.name !== 'setextHeading') continue;
			const atx = /^ {0,3}(#{1,6})/.exec(inside.text);
			const level = atx ? atx[1].length : inside.text.trimEnd().endsWith('=') ? 1 : 2;
			lines += `${level} ${inside.body}\n`;
		}
		return lines;
	};

	it.each(corpus)('asks the text first and drops no heading: %s', (_id, source) => {
		for (const block of grammar([]).parse(source).blocks) {
			expect(headingsIn(block), block.text).toBe(unchecked(block));
		}
	});
});
