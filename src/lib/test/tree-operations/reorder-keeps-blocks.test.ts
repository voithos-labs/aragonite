// A reorder adds a separator only where its block would otherwise join a neighbour. That every
// block survives the move is `reorder-lands-whole.property.test.ts`.
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { reorderChildrenWithTrivia } from '../../tree-operations/reorder';
import { documentBody } from '../../tree-operations/node-primitives';
import { createSharingState } from '../../tree-operations/sharing';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

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

describe('a reorder separates only the joins that need it', () => {
	// A join that already reads as two blocks is left exactly as the author wrote it.
	it('writes no separator where the blocks were already apart', () => {
		const kinds = parse(DOC).children.map((c) => c.kind);
		const fence = kinds.lastIndexOf('fencedCode');
		const quote = kinds.indexOf('blockquote');
		const doc = parse(DOC);
		const before = doc.children.length;
		// A fence and a quote: neither can be continued into, so neither needs a separator.
		reorderChildrenWithTrivia(
			documentBody(doc),
			fence,
			quote,
			createSharingState(),
			defaultGrammarView
		);
		expect(doc.children.length).toBe(before);
		// A separator lands in the next block's leading trivia, where only the bytes show it.
		expect(serialize(doc).length).toBe(DOC.length);
	});
});
