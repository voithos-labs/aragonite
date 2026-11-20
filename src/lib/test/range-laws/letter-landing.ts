/**
 * Where a letter typed after a gesture went, read on the bytes before and after it: whether it
 * stands in a leaf's text with every block kind kept, the check a landing that never rests on
 * syntax passes (a letter on a name, a fence line or a heading's `#` renames or re-kinds a block).
 */

import type { CstNode, Document } from '#lib/core/nodes.js';
import { documentLayout, type LaidBlock } from '#lib/range-edit/layout.js';
import { blockFacts } from '#lib/schema/block-facts.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import type { Editor } from './gestures';

export interface LetterLanding {
	/** The letter stands in a leaf's text and no block kind went. */
	offSyntax: boolean;
	/** The block at `path` of the typed bytes holds the letter. */
	within(path: readonly number[]): boolean;
	/** The letter starts a paragraph after the block at `path`, the text a gap beside it gives way to. */
	after(path: readonly number[]): boolean;
}

/** Null where typing `letter` over `before` changed nothing. */
export function letterLanding(
	editor: Editor,
	before: string,
	typed: string,
	letter: string
): LetterLanding | null {
	if (typed === before) return null;
	const grammar = editor.instance.__test.getGrammar();
	const read = (bytes: string) => readAsOpened(bytes, { grammar, scope: 'document' }) as Document;
	let from = 0;
	while (from < before.length && before[from] === typed[from]) from++;
	// Among the bytes the typing added: a gap's paragraph brings a blank line too.
	const at = typed.indexOf(letter, from);
	const layout = documentLayout(measured(read(typed)));
	const point = at < 0 ? null : layout.pointAt(at);
	const leaf = point && layout.block(point.path);
	const inText =
		!!leaf?.text &&
		leaf.text.from <= at &&
		at < leaf.text.to &&
		blockFacts(leaf.type).textPosition === 'always';
	const was = kindCount(read(before).children);
	const now = kindCount(read(typed).children);
	const kept = Object.keys(was).every((kind) => (now[kind] ?? 0) >= was[kind]);
	const block = (path: readonly number[]): LaidBlock | undefined => layout.block(path);
	return {
		offSyntax: inText && kept,
		within: (path) => {
			const b = block(path);
			return !!b && b.from <= at && at < b.to;
		},
		after: (path) => {
			const b = block(path);
			return !!b && !!leaf && leaf.type === 'paragraph' && leaf.from >= b.to;
		}
	};
}

function kindCount(blocks: readonly CstNode[], into: Record<string, number> = {}) {
	for (const block of blocks) {
		into[block.kind] = (into[block.kind] ?? 0) + 1;
		if (block.children) kindCount(block.children, into);
	}
	return into;
}
