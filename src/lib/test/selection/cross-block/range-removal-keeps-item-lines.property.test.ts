// A range removal between two list items rewrites only the lines it joins: every line above the
// start's line and below the end's line keeps its bytes, and the joined line is the start's head
// and the end's tail, over bullet lists nested three deep with sublists and paragraphs under items.
// Miss-analysis: the range rows were hand-drawn, flat or one level deep, and no row ended in an
// item holding blocks under the one the range took.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { deleteRange } from '../../harness/range-delete';
import { expectParseConverged } from '../../harness/parse-converged';
import { freshOrFixedSeed } from '../../invariants/arbitraries/property-seed';

const PARAMS = { numRuns: 200, seed: freshOrFixedSeed(816816) } as const;

interface Item {
	sublist: Item[];
	paragraph: boolean;
}

const item: fc.Memo<Item> = fc.memo((depth) =>
	fc.record({
		sublist: depth > 1 ? fc.array(item(depth - 1), { maxLength: 3 }) : fc.constant([]),
		paragraph: fc.boolean()
	})
);
const list = fc.array(item(3), { minLength: 1, maxLength: 3 });

/** An item's first line: its source line, the path of its paragraph, and its text. */
interface ItemLine {
	line: number;
	path: number[];
	text: string;
}

/** The list's Markdown, every item's text and paragraph a token of its own, and each item's line. */
function written(items: Item[]): { source: string; lines: ItemLine[] } {
	const out: string[] = [];
	const lines: ItemLine[] = [];
	const write = (level: Item[], listPath: number[], indent: string): void => {
		level.forEach((it, i) => {
			const text = `t${lines.length}`;
			lines.push({ line: out.length, path: [...listPath, i, 0], text });
			out.push(`${indent}- ${text}`);
			if (it.sublist.length > 0) write(it.sublist, [...listPath, i, 1], `${indent}  `);
			if (it.paragraph) out.push('', `${indent}  p${lines.length}`);
		});
	};
	write(items, [0], '');
	return { source: out.join('\n') + '\n', lines };
}

/** Two items in document order, a start past the first's first letter and an end in the second. */
const removal = list
	.map(written)
	.filter(({ lines }) => lines.length >= 2)
	.chain(({ source, lines }) =>
		fc
			.tuple(fc.nat(lines.length - 1), fc.nat(lines.length - 1))
			.filter(([a, b]) => a < b)
			.chain(([a, b]) =>
				fc.record({
					source: fc.constant(source),
					from: fc.constant(lines[a]),
					to: fc.constant(lines[b]),
					start: fc.integer({ min: 1, max: lines[a].text.length }),
					end: fc.nat(lines[b].text.length)
				})
			)
	);

describe('a range removal between two list items', () => {
	it('keeps every line outside the two it joins', () => {
		fc.assert(
			fc.property(removal, ({ source, from, to, start, end }) => {
				const doc = parse(source);
				deleteRange(doc, { path: from.path, offset: start }, { path: to.path, offset: end });
				const before = source.split('\n');
				const above = before
					.slice(0, from.line)
					.map((l) => l + '\n')
					.join('');
				const below = before.slice(to.line + 1).join('\n');
				const startLine = before[from.line];
				const joined =
					startLine.slice(0, startLine.length - from.text.length + start) + to.text.slice(end);
				const after = serialize(doc);
				expect(after.startsWith(above + joined + '\n')).toBe(true);
				expect(after.endsWith(below)).toBe(true);
				// Anything between the joined line and the kept lines is a separator the fix-up wrote.
				const between = after.slice(above.length + joined.length + 1, after.length - below.length);
				expect(between.trim()).toBe('');
				expectParseConverged(doc);
			}),
			PARAMS
		);
	});
});
