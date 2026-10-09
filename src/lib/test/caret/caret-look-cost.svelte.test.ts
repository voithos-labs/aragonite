// @vitest-environment jsdom
// What a plain letter typed mid-word costs the drawn caret's look, in live and source mode: one
// answer per key however often it paints, no trial insertion, parse or screen read, and the same
// inline nodes visited in a block of one construct as in one of two hundred.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { insertBy } from '#lib/test/harness/insertion-routes.js';
import { installDrawnCaretStubs, runCaretFrames } from '#lib/test/harness/drawn-caret-jsdom.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments,
	type PerfSnapshot
} from '#lib/perf/instruments.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

let restoreStubs: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreStubs = installDrawnCaretStubs();
	enablePerfInstruments();
});
afterAll(() => {
	restoreStubs();
	disablePerfInstruments();
});
afterEach(destroyMountedEditors);

/** Two hundred bold words with an image among them, whose painted range is a screen read, then a
 *  plain word the caret types into. */
function manyConstructs(): string {
	const words = Array.from({ length: 200 }, (_, i) => (i === 100 ? '![img](x.png)' : `**w${i}**`));
	return `${words.join(' ')} plainword\n`;
}

const BLOCKS = [
	{ name: 'one construct', source: 'alpha **bold** omega\n', word: 'omega' },
	{ name: 'two hundred constructs', source: manyConstructs(), word: 'plainword' }
];

/** The counters one letter typed mid-word in `source` leaves, its frame paint included. */
async function oneKey(source: string, word: string, mode: PresentationMode): Promise<PerfSnapshot> {
	const editor = mountEditor({ source, presentationMode: mode });
	const el = surfaceAt(editor, [0]);
	placeCaret(el, source.indexOf(word) + 2);
	await editor.settle();
	runCaretFrames();
	await editor.settle();
	resetPerfInstruments();

	await insertBy('hardware key', el, 'x');
	runCaretFrames();
	await editor.settle();

	expect(editor.source()).toContain(word.slice(0, 2) + 'x' + word.slice(2));
	return perfSnapshot();
}

describe.each<PresentationMode>(['live', 'source'])(
	'a plain letter mid-word, in %s mode',
	(mode) => {
		it('costs the look one answer and no trial, parse or screen read', async () => {
			const visits: number[] = [];
			for (const { name, source, word } of BLOCKS) {
				const cost = await oneKey(source, word, mode);
				const look = {
					answers: cost.caretLookComputes,
					previews: cost.caretLookPreviews,
					parses: cost.caretLookParses,
					screenReads: cost.screenReads,
					offsetWalksWithinPaints: cost.caretLookOffsetWalks <= cost.caretPaints
				};
				expect(look, name).toEqual({
					answers: 1,
					previews: 0,
					parses: 0,
					screenReads: 0,
					offsetWalksWithinPaints: true
				});
				visits.push(cost.caretLookNodeVisits);
			}
			expect(visits[0], 'the look read the inline tree').toBeGreaterThan(0);
			expect(visits[1], 'nodes visited, two hundred constructs against one').toBe(visits[0]);
		});

		// One paint after the flush and one at the frame, what a plain key costs without the look.
		it('paints twice, the look adding none', async () => {
			for (const { name, source, word } of BLOCKS) {
				expect((await oneKey(source, word, mode)).caretPaints, name).toBe(2);
			}
		});
	}
);
