// A keystroke costs the same however many siblings its leaf has: the in-place write reads its own
// slot and its neighbours, never the whole list it sits in, at the root or inside any container.
// Miss-analysis: the keystroke cost rows counted parses and rebuilt lines, never reads of the
// leaf's own list, so a copy of that list on every key passed them all.
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import type { CstNode } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt, documentBody } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';

const TARGET = 10;

/** Each kind of list with `count` one-line paragraphs, and the path to the tenth. */
const LISTS: { name: string; source: (count: number) => string; leaf: number[] }[] = [
	{
		name: 'the document',
		source: (count) => Array.from({ length: count }, (_, i) => `line ${i}\n`).join('\n'),
		leaf: [TARGET]
	},
	{
		name: 'a blockquote',
		source: (count) => Array.from({ length: count }, (_, i) => `> line ${i}\n`).join('>\n'),
		leaf: [0, TARGET]
	},
	{
		name: 'a list item',
		source: (count) =>
			'- line 0\n' + Array.from({ length: count - 1 }, (_, i) => `\n  line ${i + 1}\n`).join(''),
		leaf: [0, 0, TARGET]
	}
];

/** Reads of the leaf's own list, by index, during the second of two keystrokes. */
function siblingReads(source: string, leaf: number[]): number {
	const { deps } = makeEditorActionsDeps(source);
	const controller = createUndoController(deps);
	const index = leaf[leaf.length - 1];
	let reads = 0;
	for (let n = 0; n < 2; n++) {
		const owner = leaf.length > 1 ? (blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode) : null;
		const parent = owner ?? deps.doc;
		const body = owner
			? { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) }
			: documentBody(deps.doc);
		const raw = parent.children![index].raw;
		const write = legalizeWrite(
			body,
			index,
			raw.replace('\n', 'Q\n'),
			'authored',
			defaultGrammarView
		);
		if (n === 1) {
			parent.children = new Proxy(parent.children!, {
				get(target, key, receiver) {
					if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
					return Reflect.get(target, key, receiver);
				}
			});
		}
		expect(controller.typeLeaf(docPathFrom(leaf), write, 0).wrote).toBe(true);
	}
	return reads;
}

// The production keystroke: a dev build's checks read whole containers by design.
beforeEach(() => configureEditorEnv({ isDev: false }));
afterEach(() => resetEditorEnv());

describe('a keystroke reads none of its leaf’s siblings beyond a fixed neighbourhood', () => {
	for (const { name, source, leaf } of LISTS) {
		it(`in ${name}, 40 siblings or 400`, () => {
			expect(siblingReads(source(400), leaf)).toBe(siblingReads(source(40), leaf));
		});
	}
});
