import { describe, it, expect } from 'vitest';
import { checkSingleNodeSink } from '$lib/invariants/single-node-sink';
import { assertSingleNodeSink, mergeWithNext } from '$lib/tree-operations';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import { fixtureReading } from '../harness/fixture-grammar';

// The single-node check runs at the write, over what a one-block write target installs (G1.35).
// Miss-analysis: both call sites passed `count <= 1` as `installed`, so the check never fired.

const node = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

describe('G1.35 single-node sink', () => {
	it('accepts a slot taking one node, or none', () => {
		expect(checkSingleNodeSink('probe', 1)).toBeNull();
		expect(checkSingleNodeSink('probe', 0)).toBeNull();
	});

	it('names the sink and the count when a slot takes several', () => {
		const violation = checkSingleNodeSink('probe', 3);
		expect(violation?.code).toBe('single-node-sink');
		expect(violation?.message).toContain('installed 3 nodes');
		expect(violation?.detail).toEqual({ sink: 'probe', installed: 3 });
	});

	// The failure path the row claims: a write target that skips the refusal its siblings make and
	// splices several blocks into a position holding one.
	it('fires through the entry point for sink N+1, and stays silent on one node', () => {
		assertSingleNodeSink('probe', [node('a\n')]);
		expect(takeDevWarns()).toEqual([]);

		assertSingleNodeSink('probe', [node('a\n'), node('b\n')]);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:single-node-sink']);
	});

	// The refusal comes first and still holds: the call is made on every real merge and answers one
	// node, however many arrived (a join whose bytes read as two blocks is declined).
	it('stays silent through the merge entry points, refused join included', () => {
		const plural = parse('# h\ntext\nmore\n');
		expect(mergeWithNext(plural, 0, fixtureReading(), undefined).change).toEqual({
			op: 'noop'
		});
		expect(takeDevWarns()).toEqual([]);

		const ordinary = parse('alpha\n\nbeta\n');
		expect(mergeWithNext(ordinary, 0, fixtureReading(), undefined).change.op).toBe('replace');
		expect(takeDevWarns()).toEqual([]);
	});
});
