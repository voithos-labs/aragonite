import { describe, it, expect } from 'vitest';
import { handleDelimiter, processEmphasis } from '../../../../core/inline/scan/emphasis';
import {
	createScanContext,
	flushPendingText,
	type ScanContext
} from '../../../../core/inline/scan/scan-state';
import { emphasisNode, textNode } from './scan-test-helpers';

// The floor contract: a `]` handler calls processEmphasis(ctx, bracket.delimiterFloor)
// so only delimiters inside the bracket participate; scan end calls floor 0 for the rest.

function scanDelimiterFixture(raw: string): ScanContext {
	const ctx = createScanContext(raw, 0, raw.length);
	while (ctx.pos < ctx.end) {
		const ch = raw[ctx.pos];
		if (ch === '*' || ch === '_' || ch === '~') handleDelimiter(ctx);
		else ctx.pos++;
	}
	flushPendingText(ctx, ctx.end);
	return ctx;
}

describe('processEmphasis floor semantics', () => {
	it('processes only delimiters at index >= floor, then a floor-0 call finishes the rest', () => {
		const ctx = scanDelimiterFixture('*a* _b_');
		expect(ctx.delimiters).toHaveLength(4);

		processEmphasis(ctx, 2);
		expect(ctx.delimiters).toHaveLength(2);
		expect(ctx.nodes.map((n) => n.kind)).toEqual(['text', 'text', 'text', 'text', 'emphasis']);
		expect(ctx.nodes[4]).toEqual(emphasisNode(4, 7, [textNode(5, 6, 'b')]));

		processEmphasis(ctx, 0);
		expect(ctx.delimiters).toHaveLength(0);
		expect(ctx.nodes).toEqual([
			emphasisNode(0, 3, [textNode(1, 2, 'a')]),
			textNode(3, 4, ' '),
			emphasisNode(4, 7, [textNode(5, 6, 'b')])
		]);
	});

	it('a closer above the floor cannot reach an opener below it', () => {
		const ctx = scanDelimiterFixture('*a b*');
		expect(ctx.delimiters).toHaveLength(2);

		processEmphasis(ctx, 1);
		expect(ctx.delimiters).toHaveLength(1);
		expect(ctx.nodes.every((n) => n.kind === 'text')).toBe(true);
	});
});
