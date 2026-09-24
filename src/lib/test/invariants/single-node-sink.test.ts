import { describe, it, expect } from 'vitest';
import { checkSingleNodeSink } from '$lib/invariants/single-node-sink';
import { assertSingleNodeSink, mergeWithNext } from '$lib/tree-operations';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { fixtureLinkRef } from '../harness/fixture-grammar';

// G1.35 asks its question at the write, over the nodes a one-block write target is installing.
// Miss-analysis: the check took `installed` as `count <= 1` from both call sites, so it was always
// null and the catalog row claimed a failure path no input could reach: the refusal above it did
// all the work, and nothing answered for the next write target.

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
	// node, however many arrived (GH #166's join reads as two blocks and is declined).
	it('stays silent through the merge entry points, refused join included', () => {
		const plural = parse('# h\ntext\nmore\n');
		expect(
			mergeWithNext(plural, 0, undefined, fixtureLinkRef(), defaultGrammarView).change
		).toEqual({
			op: 'noop'
		});
		expect(takeDevWarns()).toEqual([]);

		const ordinary = parse('alpha\n\nbeta\n');
		expect(
			mergeWithNext(ordinary, 0, undefined, fixtureLinkRef(), defaultGrammarView).change.op
		).toBe('replace');
		expect(takeDevWarns()).toEqual([]);
	});
});
