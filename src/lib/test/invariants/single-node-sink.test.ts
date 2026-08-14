import { describe, it, expect } from 'vitest';
import { checkSingleNodeSink } from '$lib/invariants/single-node-sink';
import { assertSingleNodeSink, mergeWithNext } from '$lib/tree-operations';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { takeDevWarns } from '$lib/test/support/warn-gate';

// G1.35 asks its question at the WRITE, over the nodes a one-slot sink is putting in its slot.
// Miss-analysis: the predicate used to take `installed` as `count <= 1` from both call sites, so
// it was identically null and the catalog row claimed a fire path no input could reach — the
// refusal above it (the higher rung) was doing all the work, and nothing answered for sink N+1.

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

	// The fire path the row claims: a sink that skips the refusal its siblings make and splices a
	// plural replacement into a slot holding one.
	it('fires through the door for sink N+1, and stays silent on one node', () => {
		assertSingleNodeSink('probe', [node('a\n')]);
		expect(takeDevWarns()).toEqual([]);

		assertSingleNodeSink('probe', [node('a\n'), node('b\n')]);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:single-node-sink']);
	});

	// The refusal is the higher rung and still holds: the door is crossed on every real merge and
	// answers one node, plural or not (GH #166's join reads as two blocks and is declined).
	it('stays silent through the merge doors, refused join included', () => {
		const plural = parse('# h\ntext\nmore\n');
		expect(mergeWithNext(plural, 0, undefined, undefined).change).toEqual({ op: 'noop' });
		expect(takeDevWarns()).toEqual([]);

		const ordinary = parse('alpha\n\nbeta\n');
		expect(mergeWithNext(ordinary, 0, undefined, undefined).change.op).toBe('replace');
		expect(takeDevWarns()).toEqual([]);
	});
});
