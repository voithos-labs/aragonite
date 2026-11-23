/**
 * The heading outline, read block by block: what each top-level block answers to the outline's
 * `depends` (its headings, as a reader reads them), and the list those answers make together.
 */

import { builtin, trimWhitespace, type Block, type Doc } from '@voithos-labs/aragonite/plugin';

/** Deepest heading level a document can list; `[[toc]]` has no meaning past GFM's six. */
export const MAX_HEADING_DEPTH = 6;

/** One row of the outline: heading `nth` (counting every heading) of top-level block `block`. */
export interface TocEntry {
	/** Unique per position: the keyed loop's identity. */
	id: string;
	block: number;
	nth: number;
	level: number;
	label: string;
}

type Heading = [level: number, label: string, nth: number];

const isHeading = (block: Block) =>
	block.is(builtin.blocks.heading) || block.is(builtin.blocks.setextHeading);

/** The outline's `depends`: a block's headings to `maxDepth` as JSON, or '' with none, so a label
 *  may hold a line break. */
export function headingsIn(maxDepth: number): (block: Block) => string {
	return (block) => {
		// Most blocks hold no heading: skip the walk unless a `#` or an underline could start one.
		if (!/#|[=-][ \t]*\r?$/m.test(block.text)) return '';
		const found: Heading[] = [];
		let nth = 0;
		for (const inside of block.walk()) {
			if (!isHeading(inside)) continue;
			const { level } = inside.data as { level: number };
			if (level <= maxDepth) found.push([level, trimWhitespace(inside.textContent), nth]);
			nth++;
		}
		return found.length === 0 ? '' : JSON.stringify(found);
	};
}

// The answers never change once handed over, so they key the list: one outline per edit.
const outlines = new WeakMap<readonly string[], TocEntry[]>();

/** The outline the top-level blocks' answers make, in document order. */
export function outlineOf(answers: readonly string[]): TocEntry[] {
	let entries = outlines.get(answers);
	if (!entries) {
		entries = [];
		answers.forEach((answer, block) => {
			if (!answer) return;
			for (const [level, label, nth] of JSON.parse(answer) as Heading[])
				entries!.push({ id: `${block}.${nth}`, block, nth, level, label });
		});
		outlines.set(answers, entries);
	}
	return entries;
}

/** The heading an entry names in `doc`, or null once an edit has taken it away. */
export function headingOf(doc: Doc, entry: TocEntry): Block | null {
	const block = doc.blocks[entry.block];
	if (!block) return null;
	let nth = 0;
	for (const inside of block.walk()) {
		if (isHeading(inside) && nth++ === entry.nth) return inside;
	}
	return null;
}
