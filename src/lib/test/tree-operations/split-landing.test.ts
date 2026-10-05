// @vitest-environment jsdom
// Typing carries on inside a construct the split reopened; any other split lands like Home does.
// Miss-analysis: every landing test split mid-word, so a split before a construct was never asked.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { splitNode } from '$lib/tree-operations';
import { createSharingState } from '$lib/tree-operations/sharing';
import { CURSOR_EXACT_START, CURSOR_START } from '$lib/block-component';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { fixtureReading } from '../harness/fixture-grammar';

registerBuiltInBlocks();

const landing = (offset: number) =>
	splitNode(parse('ab **bold** z\n'), 0, offset, createSharingState(), fixtureReading({}, 'live'))
		.landingOffset;

describe('splitNode: where the second half takes the caret', () => {
	it('lands at raw 0 exactly when it reopened a construct there', () => {
		expect(landing(7)).toBe(CURSOR_EXACT_START);
	});

	it('lands at the start, clamped like any landing, when it reopened nothing', () => {
		expect(landing(3)).toBe(CURSOR_START);
	});
});
