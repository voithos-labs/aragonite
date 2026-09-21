// @vitest-environment jsdom
// Miss-analysis: the depth tests for GH #200 reached the render and caret paths and stopped
// there, so the code reading the same tree one gesture later (showing a source, the link card,
// joins, splits, pending marks) had no test at all and still recursed once per nesting level.
import { describe, expect, it } from 'vitest';
import { parseInline } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { constructChainAtOffset } from '$lib/components/blocks/text/construct-reveal';
import { linkConstructAt } from '$lib/components/blocks/text/link-at-point';
import { clipNodes } from '$lib/components/blocks/text/live-join-seam';
import { splittableChainAt } from '$lib/components/blocks/text/live-split-rebalance';
import { constructChainAt } from '$lib/components/blocks/text/pending-mark-insert';

// Assumes the default V8 stack, as the sibling tests do: raising `--stack-size` makes every one
// of these pass even against a recursive traversal.
const DEPTH = 32_000;

/** `leaf` under `DEPTH` nested `strong`s: the parser nests one per `**` pair, so the source is
 *  the shape, and this is the tree read back out of it. */
function nested(leaf: string): { raw: string; nodes: InlineNode[] } {
	const raw = '**'.repeat(DEPTH) + leaf + '**'.repeat(DEPTH);
	return { raw, nodes: parseInline(raw, 0, raw.length) };
}

/** The offset between the leaf's two characters: inside every construct of the chain. */
const CUT = 2 * DEPTH + 1;

describe('live gesture-seam walks at input-controlled nesting depth', () => {
	it('reveals the whole chain past the recursion ceiling, outermost first', () => {
		const chain = constructChainAtOffset(nested('ab').nodes, CUT);

		expect(chain).toHaveLength(DEPTH);
		expect(chain.findIndex((node, level) => node.start !== 2 * level)).toBe(-1);
	});

	it('finds the link the card addresses past the recursion ceiling', () => {
		const raw = '**'.repeat(DEPTH) + '[a](/u)' + '**'.repeat(DEPTH);
		const block = parse(raw + '\n', { scope: 'fragment' }).children[0];

		expect(linkConstructAt(block, 2 * DEPTH)).toMatchObject({ kind: 'link', end: 2 * DEPTH + 7 });
	});

	it('clips a join side past the recursion ceiling, on either side of the cut', () => {
		const { raw, nodes } = nested('ab');

		expect(clipNodes(nodes, CUT, 'before')).toEqual([
			{ kind: 'text', start: 2 * DEPTH, end: CUT, text: 'ab' }
		]);
		expect(clipNodes(nodes, CUT, 'after')).toEqual([
			{ kind: 'text', start: CUT, end: 2 * DEPTH + 2, text: 'ab' }
		]);
		expect(raw.slice(2 * DEPTH, CUT)).toBe('a');
	});

	it('builds the splittable chain past the recursion ceiling, outermost first', () => {
		const chain = splittableChainAt(nested('ab').nodes, CUT);

		expect(chain).toHaveLength(DEPTH);
		expect(chain!.findIndex((link, level) => link.start !== 2 * level)).toBe(-1);
	});

	it('builds the pending-mark chain past the recursion ceiling, outermost first', () => {
		const chain = constructChainAt(CUT, nested('ab').nodes);

		expect(chain).toHaveLength(DEPTH);
		expect(chain.findIndex((node, level) => node.start !== 2 * level)).toBe(-1);
	});
});
