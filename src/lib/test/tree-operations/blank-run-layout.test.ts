// A run of blank lines carries the separator and the fence-line lines where a reload puts them,
// whichever edit left it; the layout the fix-up writes is the parser's own.
// Miss-analysis: the shape check compared kinds and child counts, so a separator on the wrong
// block of a run (the same bytes, the same blocks) passed every suite.
import { describe, it, expect } from 'vitest';
import { isBlankParagraph, parse, parseContainerBody } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { describeConvergence, describeRunDivergence } from '#lib/test/harness/parse-converged.js';
import { deleteRange } from '#lib/test/harness/range-delete.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { checkSettledWindowReadsBack } from '#lib/invariants/settled-window-reads-back.js';
import { readRun, type Edge } from '#lib/tree-operations/fix-up/runs.js';

const EDGES: Edge[] = ['content', 'fence', 'none'];

/** How the parser reads a body of `lines` blank lines between `above` and `below`: the lines its
 *  fence lines take, its blank blocks, and the lines left after its last block. */
function parsedRun(lines: number, above: Edge, below: Edge) {
	// A heading interrupts the paragraph above, so a flush pair stays two blocks.
	const text =
		(above === 'content' ? 'a\n' : '') + '\n'.repeat(lines) + (below === 'content' ? '# b\n' : '');
	const wrap = { afterOpenerLine: above === 'fence', beforeCloserLine: below === 'fence' };
	const body = parseContainerBody(text, wrap, { scope: 'fragment', grammar: defaultGrammarView });
	return {
		prefix: body.prefix.length,
		blocks: body.children.filter(isBlankParagraph).length,
		suffix: body.suffix.length
	};
}

/** The same three counts, from the layout. */
function laidOutRun(lines: number, above: Edge, below: Edge) {
	const layout = readRun(lines, above, below);
	const separatorAtEnd = layout.separator && layout.blocks === 0 && below !== 'content';
	return {
		prefix: Number(layout.prefix),
		blocks: layout.blocks,
		suffix: Number(layout.suffix) + Number(separatorAtEnd)
	};
}

describe('a run an edit leaves carries its lines where a reload puts them', () => {
	it('Enter at the end of a line above a blank line puts the separator on the new line', async () => {
		const h = makeTopHarness('intro\n\n- [ ] fold laundry\n');
		await h.actions.splitBlock(0, 5);
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(describeRunDivergence(h.deps.doc)).toBeNull();
	});

	it('a range delete that blanks the block under a table keeps the blank line a block', () => {
		const source = '- | H |\n  | - |\n\n  para\n';
		const { newDoc } = deleteRange(
			parse(source),
			{ path: [0, 0, 1], offset: 0 },
			{ path: [0, 0, 1], offset: 4 }
		);
		expect(serialize(newDoc)).toBe('- | H |\n  | - |\n\n  \n');
		expect(describeConvergence(newDoc)).toBeNull();
		expect(describeRunDivergence(newDoc)).toBeNull();
	});
});

describe('G1.145 reads a run a fix-up left as a reload would lay it out', () => {
	const body = (source: string) => documentBody(parse(source));

	it('passes the runs a load lays out', () => {
		expect(checkSettledWindowReadsBack(body('a\n\n\n\nb\n'), 0, 3, defaultGrammarView)).toBeNull();
	});

	it.each([
		['a separator on the block under a blank block', 'a\n\n\nb\n', [1, 2], ['', '\n']],
		['a second separator in the run', 'a\n\n\nb\n', [1, 2], ['\n', '\n']],
		['no separator under a blank block', 'a\n\n\nb\n', [1], ['']]
	])('fails %s', (_label, source, at, trivia) => {
		const laid = body(source);
		at.forEach((index, i) => (laid.children[index].leadingTrivia = trivia[i]));
		expect(checkSettledWindowReadsBack(laid, 0, 2, defaultGrammarView)?.code).toBe(
			'settled-window-reads-back'
		);
	});
});

describe('the layout the fix-up writes is the one the parser reads', () => {
	for (const above of EDGES) {
		for (const below of EDGES) {
			it(`a run between ${above} and ${below}`, () => {
				for (let lines = 0; lines <= 5; lines++) {
					const laidOut = laidOutRun(lines, above, below);
					expect(laidOut, `${lines} lines`).toEqual(parsedRun(lines, above, below));
				}
			});
		}
	}
});
