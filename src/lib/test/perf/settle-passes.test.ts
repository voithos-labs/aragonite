// How many blank-line and neighbour fix-up passes one gesture runs (`settlePasses`): a commit runs
// one over each body it wrote, so an op that fixes up its own body as well shows here as an extra.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

/** The passes `gesture` runs on a fresh top-level document from `source`. */
async function passesOf(
	source: string,
	gesture: (h: ReturnType<typeof makeTopHarness>) => Promise<unknown>
): Promise<number> {
	const h = makeTopHarness(source);
	enablePerfInstruments();
	resetPerfInstruments();
	await gesture(h);
	return perfSnapshot().settlePasses;
}

beforeEach(() => resetPerfInstruments());
afterEach(() => disablePerfInstruments());

describe('fix-up passes per gesture', () => {
	it('a typed character runs two: the trial before the write, then the write in place', async () => {
		const passes = await passesOf('one\n\ntwo\n', (h) =>
			h.actions.updateBlockContent(0, 'onex\n', 'authored', 'join-typing', 3, 4)
		);
		expect(passes).toBe(2);
	});

	// The commit's write fixes up the written slot as it lands, and the commit the window after.
	it('a keystroke that changes the kind runs three: the trial, its write, its commit', async () => {
		const passes = await passesOf('one\n\ntwo\n', (h) =>
			h.actions.updateBlockContent(0, '# one\n', 'authored', 'join-typing', 0, 2)
		);
		expect(passes).toBe(3);
	});

	it('Enter mid-paragraph runs two: the split’s own lower join, then its commit', async () => {
		const passes = await passesOf('one\n\ntwo\n', (h) => h.actions.splitBlock(0, 1));
		expect(passes).toBe(2);
	});

	it('Backspace joining two paragraphs runs one, at its commit', async () => {
		const passes = await passesOf('one\n\ntwo\n', (h) => h.actions.mergeWithPrevious(1));
		expect(passes).toBe(1);
	});

	it('deleting a block runs one, at its commit', async () => {
		const passes = await passesOf('one\n\ntwo\n\nthree\n', (h) =>
			h.actions.deleteBlock(1, 'keyless')
		);
		expect(passes).toBe(1);
	});
});
