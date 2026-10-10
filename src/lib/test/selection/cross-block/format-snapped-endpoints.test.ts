// @vitest-environment jsdom
// The toggle plans from the covered range, which snaps a table endpoint to whole rows, so it marks
// the cell set the highlight, copy and range delete agree on.
// Miss-analysis: every plan case called `planCrossBlockFormat` with its own points, past the snap.
import { describe, expect, it } from 'vitest';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { makeKeydownEnv, press } from './keydown-env';

const SOURCE = 'head\n\n| Ha | Hb |\n| --- | --- |\n| a1 | a2 |\n';
/** Body row 0, column 0: the one column the whole-row snap has to move off. */
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
});
