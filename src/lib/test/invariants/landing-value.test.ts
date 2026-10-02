// @vitest-environment jsdom
// G1.43: a commit reads its landing as a value, and a landing function that moves focus or the
// selection itself is reported the first time a test runs it.
import { afterEach, describe, expect, it } from 'vitest';
import { checkLandingIsAValue, readCaretWhereabouts } from '$lib/invariants/landing-value';
import type { StructuralChange } from '$lib/tree-operations/structural-change';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { asDocPath } from '$lib/selection/path-math';
import { makeTopHarness } from '../harness/editor-actions';
import { takeDevWarns } from '../support/warn-gate';

const deleteSecond = (children: unknown[]): StructuralChange => {
	children.splice(1, 1);
	return { op: 'delete', at: 1, count: 1 };
};

function plantedInput(): HTMLInputElement {
	const input = document.createElement('input');
	document.body.append(input);
	return input;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('G1.43 a landing is a value', () => {
	it('accepts a read that left focus and the selection where they were', () => {
		const before = readCaretWhereabouts();
		expect(checkLandingIsAValue(before, readCaretWhereabouts())).toBeNull();
	});

	it('names a read that moved focus', () => {
		const before = readCaretWhereabouts();
		plantedInput().focus();
		expect(checkLandingIsAValue(before, readCaretWhereabouts())?.code).toBe('landing-is-a-value');
	});

	it('reports a landing function that places a caret itself, and lands its value anyway', async () => {
		const input = plantedInput();
		const h = makeTopHarness('a\n\nb\n\nc\n');
		await h.controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: deleteSecond,
			landing: () => {
				input.focus();
				return { path: docPathFrom([0]), offset: 0 };
			}
		});
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:landing-is-a-value']);
		expect(h.landings).toEqual([{ leafPath: [0], offset: 0, outcome: 'placed' }]);
	});

	it('stays silent for a landing function that only returns its position', async () => {
		const h = makeTopHarness('a\n\nb\n\nc\n');
		await h.controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: deleteSecond,
			landing: () => ({ path: docPathFrom([0]), offset: 0 })
		});
		expect(takeDevWarns()).toEqual([]);
	});
});
