// A move, through its commit, must not change what the document contains, and must leave the
// tree a reload reads, for every kind a user moves, every separator shape and (from, to), both
// line endings, and with or without a final line break.
// Miss-analysis: GH #587, one LF fixture never checked the reload, and every draw ended in a break.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { parse, isBlankParagraph } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { describeConvergence } from '$lib/testing/parse-convergence';
import { MATH_BLOCK, registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { createReorderAction } from '$lib/editor-actions/reorder-action';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

const PARAMS = { numRuns: 300, seed: freshOrFixedSeed(414141) } as const;

beforeEach(() => {
	registerMathBlock();
});

// The blocks a user moves, and the prose they land beside; what each becomes flush against a
// neighbour is the grammar's call (a rule under prose is a setext underline).
const BLOCKS = {
	prose: 'Intro prose that runs on.',
	heading: '# Heading',
	table: '| A | B |\n| --- | --- |\n| 1 | 2 |',
	code: '```js\nconst a = 1;\n```',
	math: '$$\nx^2\n$$',
	list: '- one\n- two',
	quote: '> quoted line',
	divider: '---',
	image: '![cat](cat.png)',
	html: '<div>\nx\n</div>'
} as const;
type Kind = keyof typeof BLOCKS;

// '' puts the next block flush (the grammar decides whether it still opens); one line is the
// ordinary separator; two lines make a blank paragraph node that travels with neither neighbour.
type Gap = 'flush' | 'line' | 'double';

interface Shape {
	kinds: Kind[];
	gaps: Gap[];
	eol: '\n' | '\r\n';
	/** Whether the document ends in a line break. */
	closed: boolean;
}

const arbShape: fc.Arbitrary<Shape> = fc
	.record({
		kinds: fc.array(fc.constantFrom(...(Object.keys(BLOCKS) as Kind[])), {
			minLength: 2,
			maxLength: 5
		}),
		gaps: fc.array(fc.constantFrom<Gap>('flush', 'line', 'double'), { minLength: 4, maxLength: 4 }),
		eol: fc.constantFrom<'\n' | '\r\n'>('\n', '\r\n'),
		closed: fc.boolean()
	})
	.map(({ kinds, gaps, eol, closed }) => ({
		kinds,
		gaps: gaps.slice(0, kinds.length - 1),
		eol,
		closed
	}));

function markdownOf({ kinds, gaps, eol, closed }: Shape): string {
	const gapBytes = { flush: '', line: eol, double: eol + eol };
	const md = kinds
		.map(
			(kind, i) =>
				BLOCKS[kind].replace(/\n/g, eol) + eol + (i < gaps.length ? gapBytes[gaps[i]] : '')
		)
		.join('');
	return closed ? md : md.slice(0, -eol.length);
}

/** Content blocks by kind and bytes; blank paragraphs are separator bookkeeping, not content. */
function contentOf(children: readonly CstNode[]): string[] {
	return children.filter((n) => !isBlankParagraph(n)).map((n) => `${n.kind}:${n.raw.trim()}`);
}

/** `a` minus one occurrence of each element of `b`; null when `b` names something `a` lacks. */
function minus(a: readonly string[], b: readonly string[]): string[] | null {
	const out = [...a];
	for (const x of b) {
		const i = out.indexOf(x);
		if (i < 0) return null;
		out.splice(i, 1);
	}
	return out;
}

/**
 * Every content block survives, except that two blocks flush against both sides of the moved one
 * may rejoin once it leaves, as deleting it would leave them.
 */
function contentPreserved(before: readonly CstNode[], from: number, after: readonly CstNode[]) {
	const expected = contentOf(before);
	const got = contentOf(after);
	if (expected.length === got.length && minus(expected, got)?.length === 0) return true;
	const above = before[from - 1];
	const below = before[from + 1];
	if (!above || !below || isBlankParagraph(above) || isBlankParagraph(below)) return false;
	if (before[from].leadingTrivia || below.leadingTrivia) return false;
	const rest = minus(expected, contentOf([above, below]));
	const folded = rest && minus(got, rest);
	return folded !== null && folded.length === 1;
}

describe('a reorder lands its block whole beside any neighbour', () => {
	// Without the math registration the `$$` block is a paragraph, and every row below still passes.
	it('reads the math block as the math kind', () => {
		expect(parse(`${BLOCKS.math}\n`).children[0].kind).toBe(MATH_BLOCK);
	});

	it('keeps every content block, converges on reload, writes the document’s own ending, and keeps its final state', async () => {
		await fc.assert(
			fc.asyncProperty(arbShape, async (shape) => {
				const md = markdownOf(shape);
				const before = parse(md).children;
				const total = before.length;
				for (let from = 0; from < total; from++) {
					if (isBlankParagraph(before[from])) continue;
					for (let to = 0; to < total; to++) {
						if (to === from) continue;
						const { deps } = makeEditorActionsDeps(parse(md));
						await createReorderAction(deps, createUndoController(deps)).moveReorderUnit([from], to);
						const doc = deps.doc;
						const label = `${JSON.stringify(md)} move ${from}->${to}`;
						expect(
							contentPreserved(before, from, doc.children),
							`${label}: a block folded; before ${JSON.stringify(contentOf(before))}, after ${JSON.stringify(contentOf(doc.children))}`
						).toBe(true);
						expect(describeConvergence(doc), `${label}: reload diverges`).toBeNull();
						const out = serialize(doc);
						const bare = shape.eol === '\r\n' ? /(^|[^\r])\n/.test(out) : /\r/.test(out);
						expect(bare, `${label}: a separator carries the wrong line ending`).toBe(false);
						// A blank line is its own line break, so a document ending in one ends in a break.
						const blankTail = isBlankParagraph(doc.children[doc.children.length - 1]);
						expect(out.endsWith('\n'), `${label}: the final line break changed`).toBe(
							shape.closed || blankTail
						);
					}
				}
			}),
			PARAMS
		);
		// Every draw runs every move, which can pass Vitest's default timeout when workers contend.
	}, 30_000);
});
