import { describe, it } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '../../core/nodes';
import { parseInline } from '../../core/inline';
import { arbInlineSource, freshOrFixedSeed } from './arbitraries';

// G2.5: the inline tree tiles the content range, which cursor mapping depends on. NOT
// leaf-exhaustive — a wrapped node's markers live in the edge gaps its children leave, and
// the renderer pulls them from exactly there. Only the TOP level has no edge gap.

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

function assertPartition(nodes: InlineNode[], rangeStart: number, rangeEnd: number): void {
	if (nodes.length === 0) {
		if (rangeStart !== rangeEnd) {
			throw new Error(`empty node list for non-empty range [${rangeStart},${rangeEnd})`);
		}
		return;
	}
	if (nodes[0].start !== rangeStart) {
		throw new Error(
			`top-level gap: first node starts at ${nodes[0].start}, range at ${rangeStart}`
		);
	}
	if (nodes[nodes.length - 1].end !== rangeEnd) {
		throw new Error(
			`top-level gap: last node ends at ${nodes[nodes.length - 1].end}, range at ${rangeEnd}`
		);
	}
	assertLevel(nodes);
}

function assertLevel(nodes: InlineNode[]): void {
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (n.end < n.start) throw new Error(`inverted range on ${n.kind}[${n.start},${n.end}]`);
		if (i > 0 && nodes[i - 1].end !== n.start) {
			throw new Error(
				`sibling gap/overlap: ${nodes[i - 1].kind} ends ${nodes[i - 1].end}, ` +
					`${n.kind} starts ${n.start}`
			);
		}
		if (n.children && n.children.length > 0) {
			const first = n.children[0];
			const last = n.children[n.children.length - 1];
			if (n.start > first.start) {
				throw new Error(`${n.kind} start ${n.start} after child start ${first.start}`);
			}
			if (last.end > n.end) {
				throw new Error(`${n.kind} end ${n.end} before child end ${last.end}`);
			}
			assertLevel(n.children);
		}
	}
}

describe('G2.5 inline-tree offset partition', () => {
	it('siblings contiguous, parents contain children, top level covers content', () => {
		fc.assert(
			fc.property(arbInlineSource, (source) => {
				const nodes = parseInline(source, 0, source.length);
				assertPartition(nodes, 0, source.length);
			}),
			PARAMS
		);
	});

	it('holds under a non-zero content start (heading-style offset)', () => {
		fc.assert(
			fc.property(arbInlineSource, (content) => {
				const prefix = '## ';
				const raw = prefix + content;
				const nodes = parseInline(raw, prefix.length, raw.length);
				assertPartition(nodes, prefix.length, raw.length);
			}),
			PARAMS
		);
	});
});

// A link destination terminating inside a code span ends the link mid-span, leaving
// overlapping top-level siblings — unreachable until destinations could hold backticks.
describe('G2.5 pinned counterexamples', () => {
	const cases = ['[a](u`)`)', '![a](u`)`)'];

	for (const source of cases) {
		it(`link destination ending inside a code span: ${JSON.stringify(source)}`, () => {
			const nodes = parseInline(source, 0, source.length);
			assertPartition(nodes, 0, source.length);
		});
	}
});

// Asterisk delimiter nesting is out of the shared lane because it rebinds under any neighbouring
// byte, which the typing-seat net reads as its own failure (`testing.md` § Property suites). The
// partition is blind to that rebinding, so the shape is pinned rather than lost with the lane.
describe('G2.5 asterisk delimiter nesting', () => {
	const cases = ['*a *b* c*', '**a **b** c**', '**a *b** c*', '*a **b* c**'];

	for (const source of cases) {
		it(`partitions ${JSON.stringify(source)}`, () => {
			const nodes = parseInline(source, 0, source.length);
			assertPartition(nodes, 0, source.length);
		});
	}
});
