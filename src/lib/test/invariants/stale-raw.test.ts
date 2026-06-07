import { describe, it, expect } from 'vitest';
// Side-effect import: populates rebuildRaw on container descriptors.
import '../../schema/container-raw';
import { checkStaleRaw } from '../../invariants/node-shape';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';

function firstBlock(source: string): CstNode {
	return parse(source).children[0];
}

describe('checkStaleRaw (G1.1)', () => {
	it('fires when a strip container child was mutated without a rebuild', () => {
		const bq = firstBlock('> hello\n> world\n');
		bq.children![0].raw = 'changed\n';
		const violation = checkStaleRaw(bq);
		expect(violation?.code).toBe('stale-container-raw');
		expect(violation?.detail).toMatchObject({ kind: 'blockquote' });
	});

	it('fires for a stale list', () => {
		const list = firstBlock('- a\n- b\n');
		list.children![0].raw = '- z\n';
		expect(checkStaleRaw(list)).not.toBeNull();
	});

	it('does not mutate the input node', () => {
		const bq = firstBlock('> hello\n> world\n');
		bq.children![0].raw = 'changed\n';
		const before = bq.raw;
		checkStaleRaw(bq);
		expect(bq.raw).toBe(before);
		expect(bq.children![0].raw).toBe('changed\n');
	});

	it('passes for a freshly parsed blockquote', () => {
		expect(checkStaleRaw(firstBlock('> hello\n> world\n'))).toBeNull();
	});

	it('passes for a freshly parsed list', () => {
		expect(checkStaleRaw(firstBlock('- a\n- b\n'))).toBeNull();
	});

	it('returns null for a grid container (table is exempt)', () => {
		const table = firstBlock('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
		expect(table.kind).toBe('table');
		expect(checkStaleRaw(table)).toBeNull();
	});

	it('returns null for a leaf', () => {
		expect(checkStaleRaw(firstBlock('plain\n'))).toBeNull();
	});
});
