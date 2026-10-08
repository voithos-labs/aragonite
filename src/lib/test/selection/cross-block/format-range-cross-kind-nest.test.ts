// @vitest-environment jsdom
// The cross-block toggle over a block whose whole content is another kind's run has no rules of
// its own, so it must land exactly what the single-block toggle lands on the same bytes
// (`core/inline/format-toggle-cross-kind-nest.test.ts`).
// Miss-analysis: no case put a block the toggle writes but then reads as unchanged into a range.
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '#lib/selection/cross-block/format-range.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { coverRange } from '#lib/selection/range-coverage.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

const MODES: ('source' | 'live')[] = ['source', 'live'];

function toggle(
	source: string,
	start: SelectionPoint,
	end: SelectionPoint,
	mode: 'source' | 'live'
) {
	const doc = parse(source);
	const plan = planCrossBlockFormat(
		doc,
		coverRange(doc, start, end),
		'strong',
		fixtureReading({}, mode)
	);
	if (!plan) return null;
	applyCrossBlockFormat(documentBody(doc), plan, createSharingState(), defaultGrammarView);
	return serialize(doc);
}

describe.each(MODES)('a middle block whose content is one run of another kind (%s)', (mode) => {
	it('marks it with its neighbours instead of skipping it', () => {
		expect(toggle('head\n\n*ab*\n\ntail\n', at([0], 0), at([2], 4), mode)).toBe(
			'**head**\n\n***ab***\n\n**tail**\n'
		);
	});

	// The direction vote reads the same block, so a nested run read as unmarked would make the
	// keystroke an apply, which every marked neighbour then sits out, writing nothing.
	it('votes with its neighbours, so the covered range unapplies whole', () => {
		expect(toggle('**head**\n\n***ab***\n\n**tail**\n', at([0], 0), at([2], 8), mode)).toBe(
			'head\n\n*ab*\n\ntail\n'
		);
	});

	// A construct carrying no mark of its own reaches the vote the same way, from the other side:
	// a block read as unmarked would be marked a second time.
	it('counts a link whose whole text is marked, so the range unapplies rather than doubling it', () => {
		expect(toggle('**head**\n\n[**a**](u)\n\n**tail**\n', at([0], 0), at([2], 8), mode)).toBe(
			'head\n\n[a](u)\n\ntail\n'
		);
	});
});
