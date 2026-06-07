import { describe, it, expect } from 'vitest';
import { checkContentRange } from '../../invariants/descriptor';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';

function leaf(source: string): CstNode {
	return parse(source).children[0];
}

describe('checkContentRange (G1.8)', () => {
	it('fires when start exceeds end', () => {
		const node = leaf('hello\n');
		const violation = checkContentRange(node, () => ({ start: 4, end: 2 }));
		expect(violation?.code).toBe('content-range-out-of-bounds');
	});

	it('fires when end exceeds displayLength(raw)', () => {
		const node = leaf('hi\n');
		const violation = checkContentRange(node, () => ({ start: 0, end: 99 }));
		expect(violation?.detail).toMatchObject({ start: 0, end: 99, len: 2 });
	});

	it('fires when start is negative', () => {
		const node = leaf('hi\n');
		expect(checkContentRange(node, () => ({ start: -1, end: 2 }))).not.toBeNull();
	});

	it('passes for a real paragraph', () => {
		expect(checkContentRange(leaf('hello world\n'))).toBeNull();
	});

	it('passes for a real heading (marker-skipping range)', () => {
		expect(checkContentRange(leaf('## Title\n'))).toBeNull();
	});

	it('passes for an empty range at the boundary', () => {
		const node = leaf('hi\n');
		expect(checkContentRange(node, () => ({ start: 2, end: 2 }))).toBeNull();
	});

	it('returns null for a non-prose kind', () => {
		expect(checkContentRange(leaf('---\n'))).toBeNull();
	});
});
