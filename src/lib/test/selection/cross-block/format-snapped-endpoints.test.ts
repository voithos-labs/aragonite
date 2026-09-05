// @vitest-environment jsdom
//
// The arm plans from `SelectionState.start/end`, which whole-row-snap a table endpoint, not from
// the anchor/focus the gesture stored. Highlight, clipboard copy and range delete already agree on
// the snapped cell set; a toggle planning from the raw pair would mark a different one.
//
// Miss-analysis: every plan case builds its own points and calls `planCrossBlockFormat` directly,
// so the snap sat between the arm and the plan with no test on that edge at all.
import { describe, expect, it } from 'vitest';
import { planCrossBlockFormat } from '$lib/selection/cross-block/format-range';
import type { SelectionPoint } from '$lib/selection/primitives';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'head\n\n| Ha | Hb |\n| --- | --- |\n| a1 | a2 |\n';
/** Body row 0, column 0 — the one column the whole-row snap has to move off. */
const MID_ROW_CELL: SelectionPoint = { path: [1], offset: 2, cellCoordinate: true };
const DOC_START: SelectionPoint = { path: [0], offset: 0 };

describe('a toggle over a range whose table endpoint sits mid-row', () => {
	it('marks the whole row the snap covers, not the cells up to the raw endpoint', async () => {
		const env = makeKeydownEnv(SOURCE);
		env.selection.enterCrossBlock(DOC_START, MID_ROW_CELL);
		expect(env.selection.end?.offset).toBe(3);

		await env.keydown.handleKeyDown(press('b', { ctrlKey: true }));

		expect(env.source()).toBe(
			'**head**\n\n| **Ha** | **Hb** |\n| --- | --- |\n| **a1** | **a2** |\n'
		);
	});

	// The contrast that makes the assertion above mean something: the raw pair stops one cell short.
	it('stops at the raw endpoint when the unsnapped pair is planned directly', () => {
		const env = makeKeydownEnv(SOURCE);
		const plan = planCrossBlockFormat(env.deps.doc, DOC_START, MID_ROW_CELL, 'strong', undefined)!;
		expect(plan.writes.map((write) => write.path)).toEqual([[0], [1, 0, 0], [1, 0, 1], [1, 1, 0]]);
	});
});
