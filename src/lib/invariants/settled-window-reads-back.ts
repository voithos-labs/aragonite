/**
 * G1.145: the blocks a fix-up wrote, read again together with the blocks either side, come back as
 * the same blocks with the same blank lines between them, so the live tree divides those bytes the
 * way a reload does. A leaf's own trailing blank line counts as a hidden line of the gap below it.
 */

import type { CstNode } from '../core/nodes';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { isBlankParagraph, readBlocks } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';

export function checkSettledWindowReadsBack(
	body: { readonly children: readonly CstNode[] },
	lo: number,
	hi: number,
	grammar: GrammarView
): InvariantViolation | null {
	const window = body.children.slice(Math.max(lo - 1, 0), hi + 2);
	if (window.length === 0) return null;
	const read = (bytes: string) => readBlocks(bytes, { grammar, scope: 'fragment' }).children;
	// A block that reads otherwise alone (a list item's bytes read as a list, a table cell's as a
	// paragraph) has no standalone reading to compare against.
	if (window.some((node) => read(node.raw)[0]?.kind !== node.kind)) return null;
	let bytes = window[0].raw;
	for (const node of window.slice(1)) bytes += node.leadingTrivia + node.raw;
	const live = shapeOf(window);
	const reread = shapeOf(read(bytes));
	if (live.join('\0') === reread.join('\0')) return null;
	return {
		code: 'settled-window-reads-back',
		message: `a fix-up left blocks ${lo}-${hi} divided otherwise than a reload reads them`,
		detail: { live, reread }
	};
}

const TRAILING_BLANK_LINES = /(?:\r?\n[ \t]*)+$/;
const lineCount = (text: string): number => (text.match(/\n/g) ?? []).length;

/** Each content block as its kind and its bytes less trailing blank lines, and between two of them
 *  the hidden lines above each block of the run (a leaf's own trailing lines count above the first). */
function shapeOf(blocks: readonly CstNode[]): string[] {
	const shape: string[] = [];
	let run: number[] = [];
	let own = 0;
	for (const block of blocks) {
		run.push(lineCount(block.leadingTrivia) + (run.length === 0 ? own : 0));
		if (isBlankParagraph(block)) continue;
		if (shape.length > 0) shape.push(`gap ${run.join(' ')}`);
		const text = block.raw.replace(TRAILING_BLANK_LINES, '');
		shape.push(`${block.kind} ${text}`);
		run = [];
		// The ending of the text's own last line is no blank line.
		own = block.children ? 0 : Math.max(lineCount(block.raw.slice(text.length)) - 1, 0);
	}
	return shape;
}
