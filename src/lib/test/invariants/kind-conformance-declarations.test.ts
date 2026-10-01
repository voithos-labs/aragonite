// The kind kit's declarations cell: a kind that leaves `settledAtLastLine` out claims its reading
// never backs out of a construct the lines below would complete, and its fixture is probed for that.
// Miss-analysis: the join refusal trusted every kind's last line, and nothing asked a kind whether
// its reading could still change once more lines arrive.
import { describe, it, expect } from 'vitest';
import type { AnyBlockKind } from '$lib/core/nodes';
import { runKindConformance } from '$lib/testing';
import { checkSettledAtLastLine } from '$lib/testing/kind-conformance';

const statusOf = async (kind: AnyBlockKind) =>
	(await runKindConformance(kind)).cells.find((c) => c.cell === 'declarations')?.status;

describe('kind conformance: the declarations cell', () => {
	it('catches a definition with no title, which backs out of a title left open below it', () => {
		expect(() => checkSettledAtLastLine('linkReferenceDefinition', '[a]: /u\n')).toThrow(
			/declare settledAtLastLine: false/
		);
	});

	// The probe completes a title the block left room for; a fixture that already has one gives it
	// nothing to complete, so the built-in definition declares its answer by hand.
	it('can’t see it through a definition whose fixture already has a title', () => {
		expect(() => checkSettledAtLastLine('linkReferenceDefinition', '[a]: /u "t"\n')).not.toThrow();
	});

	it('asserts a kind whose reading ends at its last line, and exempts one declaring otherwise', async () => {
		expect(await statusOf('heading')).toBe('asserted');
		expect(await statusOf('linkReferenceDefinition')).toBe('exempt');
	});
});
