// @vitest-environment jsdom
//
// The cross-block toggle over a block whose whole content is another kind's run. It has no rules
// of its own, so it must land exactly what the single-block toggle lands on the same bytes
// (`core/inline/format-toggle-cross-kind-nest.test.ts`); where the re-read after the write
// disowned it, the block was dropped in silence while its neighbours were marked.
//
// Miss-analysis: every cross-block case gave its middle block plain content or a run of the format
// pressed, so no case ever put a block the toggle writes and then reads as unchanged into a range.
import { defaultGrammarView } from '$lib/schema/block-openers';
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSharingState } from '$lib/tree-operations/sharing';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';
import { documentLineEnding } from '$lib/core/lines';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

const MODES: ('source' | 'live')[] = ['source', 'live'];

function toggle(
	source: string,
	start: SelectionPoint,
	end: SelectionPoint,
	mode: 'source' | 'live'
) {
	const doc = parse(source);
	const plan = planCrossBlockFormat(doc, start, end, 'strong', mode, {
		grammar: defaultGrammarView
	});
	if (!plan) return null;
	applyCrossBlockFormat(
		doc,
		plan,
		createSharingState(),
		documentLineEnding(doc),
		defaultGrammarView
	);
	return serialize(doc);
}

describe.each(MODES)('a middle block whose content is one run of another kind (%s)', (mode) => {
	it('marks it with its neighbours instead of skipping it', () => {
		expect(toggle('head\n\n*ab*\n\ntail\n', at([0], 0), at([2], 4), mode)).toBe(
			'**head**\n\n***ab***\n\n**tail**\n'
		);
	});

	// The direction vote reads the same block, so a nested run it called unmarked made the whole
	// keystroke an apply, and then every marked neighbour sat the keystroke out too, writing
	// nothing at all.
	it('votes with its neighbours, so the covered range unapplies whole', () => {
		expect(toggle('**head**\n\n***ab***\n\n**tail**\n', at([0], 0), at([2], 8), mode)).toBe(
			'head\n\n*ab*\n\ntail\n'
		);
	});

	// A construct carrying no mark of its own reaches the vote the same way, and got it wrong the
	// other direction: the block the range called unmarked was the one the keystroke marked again.
	it('counts a link whose whole text is marked, so the range unapplies rather than doubling it', () => {
		expect(toggle('**head**\n\n[**a**](u)\n\n**tail**\n', at([0], 0), at([2], 8), mode)).toBe(
			'head\n\n[a](u)\n\ntail\n'
		);
	});
});
