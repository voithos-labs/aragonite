// @vitest-environment jsdom
//
// `paintedRange` in `edge-seat.ts` reads a childless construct's visible span as the outer bounds
// of its visible runs, and carves the two marker runs out of what is left. That rests on the runs
// being contiguous: a hidden run in the middle would put the caret's written offset inside bytes
// the user can see. A property over rendered documents rather than a keystroke-time assertion:
// the claim is about the render path's output shape for a class of nodes, not about an instance.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { constructContentRange, parseInline } from '$lib/core/inline';
import { screenVisibility, visibleRuns, type VisibleRun } from '$lib/core/inline/visibility';
import type { AnyInlineKind, InlineNode } from '$lib/core/nodes';
import { arbInlineSource, freshOrFixedSeed } from '$lib/test/invariants/arbitraries';
import '$lib/schema/built-in-descriptors';
import { renderOptions } from '../../harness/fixture-grammar';

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(413771) } as const;

/** Every fixture holds content, so its markers hide: the live-mode reading `paintedRange` uses. */
const LIVE = screenVisibility('live', { chromePaints: false });

/** The exact predicate `paintedRange`'s caller uses to reach it. */
function childlessConstructs(nodes: readonly InlineNode[], out: InlineNode[] = []): InlineNode[] {
	for (const node of nodes) {
		if (node.kind !== 'text' && constructContentRange(node) === null) out.push(node);
		if (node.children) childlessConstructs(node.children, out);
	}
	return out;
}

/** The same filter `paintedRange` applies before taking its outer bounds. */
const paintedRunsOf = (node: InlineNode, raw: string): VisibleRun[] =>
	visibleRuns([node], raw, LIVE, renderOptions()).filter((run) => run.visible && run.text !== '');

/** The first gap between two painted runs, or null when they are one stretch. */
function firstGap(runs: readonly VisibleRun[]): string | null {
	for (let i = 1; i < runs.length; i++) {
		if (runs[i - 1].end !== runs[i].start) return `${runs[i - 1].end} ≠ ${runs[i].start}`;
	}
	return null;
}

describe('a childless construct paints one contiguous stretch', () => {
	// The shapes `paintedRange` was written for, stated outright: an escape, both autolink
	// spellings, a hard break, and the content-empty link and image whose whole node is markers.
	it.each([
		'x \\* y',
		'see <http://e.com> now',
		'a <mail@e.com> b',
		'end  \nnext',
		'A [](u) B',
		'A ![](u) B'
	])('over %j', (raw) => {
		const nodes = parseInline(raw, 0, raw.length);
		const childless = childlessConstructs(nodes);
		expect(childless.length).toBeGreaterThan(0);
		for (const node of childless) expect(firstGap(paintedRunsOf(node, raw))).toBeNull();
	});

	it('over drawn inline documents, with the hidden runs a prefix and a suffix', () => {
		const kindsSeen = new Set<AnyInlineKind>();

		fc.assert(
			fc.property(arbInlineSource, (raw) => {
				for (const node of childlessConstructs(parseInline(raw, 0, raw.length))) {
					kindsSeen.add(node.kind);
					const painted = paintedRunsOf(node, raw);
					if (painted.length === 0) continue;
					expect(firstGap(painted), `${raw} :: ${node.kind}`).toBeNull();
					// The bounds `paintedRange` returns, and the two runs it derives from them.
					const bounds = { start: painted[0].start, end: painted[painted.length - 1].end };
					expect(bounds.start).toBeGreaterThanOrEqual(node.start);
					expect(bounds.end).toBeLessThanOrEqual(node.end);
				}
				return true;
			}),
			PARAMS
		);

		// Non-vacuity: a generator that drew no childless construct would pass every arm above.
		expect([...kindsSeen].sort()).toEqual(
			expect.arrayContaining(['autolink', 'escape', 'hardLineBreak'])
		);
	});

	// The gap finder's own non-vacuity: a stretch with a hidden run through the middle is exactly
	// the shape that would make `paintedRange`'s outer bounds span bytes the user never saw.
	it('the gap detector sees a hidden run between two painted ones', () => {
		const run = (start: number, end: number): VisibleRun => ({
			start,
			end,
			text: 'x',
			visible: true
		});
		expect(firstGap([run(0, 2), run(2, 4)])).toBeNull();
		expect(firstGap([run(0, 2), run(3, 5)])).toBe('2 ≠ 3');
	});
});
