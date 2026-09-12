// A reorder must not change what the document contains, and the tree it leaves must be the one
// a reload reads: every kind a reader picks up, against prose and against each other, over every
// separator shape and every (from, to), in both line endings.
// Miss-analysis: reorder-keeps-blocks.test.ts pinned the block multiset over one LF fixture whose
// blocks were all blank-line separated; nothing asked whether the settled tree reloads to itself,
// what ending a minted separator carries, or what the pair around the vacated slot becomes.
import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { parse, isBlankParagraph } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { describeConvergence } from '$lib/testing/parse-convergence';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

const PARAMS = { numRuns: 300, seed: freshOrFixedSeed(414141) } as const;

beforeAll(() => {
	resetPluginPlatformForTests();
	registerMathBlock();
});

// The blocks a reader moves, and the prose they land beside. Each is one block on its own; what
// it becomes flush against a neighbour is the grammar's call (a rule under prose is a setext
// underline, a picture under prose is an inline image, a table under prose is its continuation).
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

// '' seats the next block flush (the grammar decides whether it still opens); one line is the
// ordinary separator; two lines mint a blank paragraph node that travels with neither neighbour.
type Gap = 'flush' | 'line' | 'double';

interface Shape {
	kinds: Kind[];
	gaps: Gap[];
	eol: '\n' | '\r\n';
}

const arbShape: fc.Arbitrary<Shape> = fc
	.record({
		kinds: fc.array(fc.constantFrom(...(Object.keys(BLOCKS) as Kind[])), {
			minLength: 2,
			maxLength: 5
		}),
		gaps: fc.array(fc.constantFrom<Gap>('flush', 'line', 'double'), { minLength: 4, maxLength: 4 }),
		eol: fc.constantFrom<'\n' | '\r\n'>('\n', '\r\n')
	})
	.map(({ kinds, gaps, eol }) => ({ kinds, gaps: gaps.slice(0, kinds.length - 1), eol }));

function markdownOf({ kinds, gaps, eol }: Shape): string {
	const gapBytes = { flush: '', line: eol, double: eol + eol };
	return kinds
		.map(
			(kind, i) =>
				BLOCKS[kind].replace(/\n/g, eol) + eol + (i < gaps.length ? gapBytes[gaps[i]] : '')
		)
		.join('');
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
 * Every content block survives, the moved one included, with one exemption the settle design
 * grants: the two blocks that STRADDLED the moved block may rejoin once it leaves, since their
 * adjacency is the reload's own reading of bytes the move never touched. Nothing else may fold.
 */
function contentPreserved(before: readonly CstNode[], from: number, after: readonly CstNode[]) {
	const expected = contentOf(before);
	const got = contentOf(after);
	if (expected.length === got.length && minus(expected, got)?.length === 0) return true;
	const above = before[from - 1];
	const below = before[from + 1];
	if (!above || !below || isBlankParagraph(above) || isBlankParagraph(below)) return false;
	const rest = minus(expected, contentOf([above, below]));
	const folded = rest && minus(got, rest);
	return folded !== null && folded.length === 1;
}

describe('a reorder lands its block whole beside any neighbour', () => {
	it('keeps every content block, converges on reload, and mints separators in the document’s own ending', () => {
		fc.assert(
			fc.property(arbShape, (shape) => {
				const md = markdownOf(shape);
				const before = parse(md).children;
				const total = before.length;
				for (let from = 0; from < total; from++) {
					if (isBlankParagraph(before[from])) continue;
					for (let to = 0; to < total; to++) {
						if (to === from) continue;
						const doc = parse(md);
						reorderChildrenWithTrivia(doc.children, from, to, createSharingState(), true);
						const label = `${JSON.stringify(md)} move ${from}->${to}`;
						expect(
							contentPreserved(before, from, doc.children),
							`${label}: a block folded; before ${JSON.stringify(contentOf(before))}, after ${JSON.stringify(contentOf(doc.children))}`
						).toBe(true);
						expect(describeConvergence(doc), `${label}: reload diverges`).toBeNull();
						const out = serialize(doc);
						const bare = shape.eol === '\r\n' ? /(^|[^\r])\n/.test(out) : /\r/.test(out);
						expect(bare, `${label}: a separator carries the wrong line ending`).toBe(false);
					}
				}
			}),
			PARAMS
		);
	});
});
