// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { metadataOf } from '$lib/core/nodes';
import { buildListBreakOutReplacement } from '$lib/tree-operations/paste/list-break-out';
import { focusIndexBeforeResidue } from '$lib/tree-operations/paste/focus-target';

describe('buildListBreakOutReplacement', () => {
	// Regression: a mismatched paste breaking out of an ordered list whose first
	// item is not "1." must keep the list's own numbering across the gap, not
	// restart both halves at 1 (matches list/exit-replacement.ts semantics).
	it('preserves a non-1 ordered base across the break-out gap', () => {
		const list = parse('3. a\n4. b\n5. c\n').children[0];
		const pasted = parse('- x\n').children; // mismatched (unordered) clipboard list

		const { replacement } = buildListBreakOutReplacement(list, 1, 0, 0, pasted);

		const orderedHalves = replacement.filter(
			(b) => b.kind === 'list' && metadataOf(b, 'list').ordered
		);
		expect(orderedHalves).toHaveLength(2);
		const [firstHalf, secondHalf] = orderedHalves;
		expect(firstHalf.children![0].metadata).toMatchObject({ marker: '3. ' });
		expect(secondHalf.children!.map((i) => metadataOf(i, 'listItem').marker)).toEqual([
			'4. ',
			'5. '
		]);
	});

	it('starts a 1-based ordered list at 1 as before', () => {
		const list = parse('1. a\n2. b\n3. c\n').children[0];
		const pasted = parse('- x\n').children;

		const { replacement } = buildListBreakOutReplacement(list, 1, 0, 0, pasted);

		const orderedHalves = replacement.filter(
			(b) => b.kind === 'list' && metadataOf(b, 'list').ordered
		);
		expect(orderedHalves[0].children![0].metadata).toMatchObject({ marker: '1. ' });
		expect(orderedHalves[1].children!.map((i) => metadataOf(i, 'listItem').marker)).toEqual([
			'2. ',
			'3. '
		]);
	});
});

describe('buildListBreakOutReplacement — trailing-residue flag drives the caret', () => {
	const list = () => parse('- one\n- two\n- three\n').children[0];
	const pasted = () => parse('1. a\n2. b\n').children;

	it('flags a residue for a mid-item break-out; caret lands one node before it', () => {
		// Break out inside "two" (offset 1) — the "wo" residue becomes the trailing
		// second-half list, so the last node is residue, not pasted content.
		const { replacement, hasTrailingResidue } = buildListBreakOutReplacement(
			list(),
			1,
			0,
			1,
			pasted()
		);
		expect(hasTrailingResidue).toBe(true);
		expect(focusIndexBeforeResidue(replacement.length, hasTrailingResidue)).toBe(
			replacement.length - 2
		);
	});

	it('flags no residue at the end of the last item; caret lands on the last node', () => {
		const { replacement, hasTrailingResidue } = buildListBreakOutReplacement(
			list(),
			2,
			0,
			'three'.length,
			pasted()
		);
		expect(hasTrailingResidue).toBe(false);
		expect(focusIndexBeforeResidue(replacement.length, hasTrailingResidue)).toBe(
			replacement.length - 1
		);
	});
});
