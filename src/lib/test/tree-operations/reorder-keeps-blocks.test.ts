// A reorder must not change what the document contains: a blank-line node doesn't travel with the
// block a drag moves, so a block landing flush under a paragraph must not become its text.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { reorderChildrenWithTrivia } from '../../tree-operations/reorder';
import { createSharingState } from '../../tree-operations/sharing';
import { defaultGrammarView } from '$lib/schema/block-openers';

// Blocks a paragraph can continue into and blocks it can't, with doubled blank lines, since an
// extra blank line is a node that doesn't travel with the block below it.
const DOC = [
	'Intro prose that runs on.',
	'',
	'',
	'| Ingredient | Amount |',
	'| --- | --- |',
	'| Water | 35 L |',
	'',
	'',
	'## A heading',
	'',
	'- one',
	'- two',
	'',
	'',
	'> quoted line',
	'',
	'```js',
	'const a = 1;',
	'```',
	'',
	'Trailing prose.',
	''
].join('\n');

/** Blocks with content, by kind and bytes: blank-line nodes are bookkeeping, not content. */
function realBlocks(markdown: string): string[] {
	return parse(markdown)
		.children.filter((node) => node.raw.trim() !== '')
		.map((node) => `${node.kind}:${node.raw.trim()}`);
}

function afterMove(from: number, to: number): string[] {
	const doc = parse(DOC);
	reorderChildrenWithTrivia(doc.children, from, to, createSharingState(), defaultGrammarView, '\n');
	return realBlocks(serialize(doc));
}

describe('a reorder keeps every block it moves past', () => {
	const total = parse(DOC).children.length;
	const draggable = parse(DOC)
		.children.map((node, i) => (node.raw.trim() === '' ? -1 : i))
		.filter((i) => i >= 0);

	it('the fixture has the blank-line nodes this guards', () => {
		expect(total).toBeGreaterThan(draggable.length);
		expect(realBlocks(DOC)).toHaveLength(draggable.length);
	});

	it('every move of every block preserves all of them, bytes included', () => {
		const expected = [...realBlocks(DOC)].sort();
		const broken: string[] = [];
		for (const from of draggable) {
			for (let to = 0; to < total; to++) {
				if (to === from) continue;
				const got = [...afterMove(from, to)].sort();
				if (got.join('|') !== expected.join('|')) {
					broken.push(`${from}->${to}: ${expected.length} => ${got.length}`);
				}
			}
		}
		expect(broken).toEqual([]);
	});

	// The rule must not pay for itself in noise: a join that already reads as two blocks is
	// left exactly as the author wrote it.
	it('writes no separator where the blocks were already apart', () => {
		const kinds = parse(DOC).children.map((c) => c.kind);
		const fence = kinds.lastIndexOf('fencedCode');
		const quote = kinds.indexOf('blockquote');
		const doc = parse(DOC);
		const before = doc.children.length;
		// A fence and a quote: neither can be continued into, so neither needs a separator.
		reorderChildrenWithTrivia(
			doc.children,
			fence,
			quote,
			createSharingState(),
			defaultGrammarView,
			'\n'
		);
		expect(doc.children.length).toBe(before);
	});
});
