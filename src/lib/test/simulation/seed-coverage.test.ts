// Miss-analysis: nothing replayed the multi-seed draws, so no one saw its eight seeds never draw
// three of the destroys, the Shift+click build or the margin click.
import { describe, it, expect } from 'vitest';
import { makeRng, type Rng } from '$lib/e2e/simulation/rng';
import { SESSION_TYPO_RATE, drawTypo } from '$lib/e2e/simulation/typos';
import {
	FLIP_MODES,
	RANGE_BUILDS,
	RANGE_DESTROYS,
	planDetours
} from '$lib/e2e/simulation/detour-plan';
import { MULTI_SEEDS } from '$lib/e2e/simulation/multi-seeds';
import { MEETING_MINUTES_NOTE } from '$lib/e2e/simulation/notes/meeting-minutes-note';
import type { Gestures } from '$lib/e2e/simulation/gestures';
import type { RangeInterruptGesture } from '$lib/e2e/simulation/gestures/range-interrupt';

// What `availableRangeInterrupts` reads off the built note: no image, a prose last block, and
// no drag handle, since every block in it is prose.
const NOTE_INTERRUPTS: readonly RangeInterruptGesture[] = [
	'dead-space-margin',
	'escape',
	'dead-space-below',
	'search-round-trip'
];

/** The build draws only typos, so a stand-in whose other gestures do nothing replays it exactly. */
async function replayBuild(rng: Rng): Promise<void> {
	const typeText = async (text: string) => {
		for (const ch of text) drawTypo(rng, SESSION_TYPO_RATE, ch);
	};
	const stub = new Proxy({} as Gestures, {
		get: (_, name) => (name === 'typeText' ? typeText : async () => {})
	});
	await MEETING_MINUTES_NOTE.build(stub);
}

async function choicesDrawn(seed: number): Promise<string[]> {
	const rng = makeRng(seed);
	await replayBuild(rng);
	const choices: string[] = [];
	for (const step of planDetours(rng)) {
		if (step.kind === 'mode-flip') choices.push(`mode-flip:${step.mode}`);
		else if (step.kind === 'cross-block') {
			choices.push(`destroy:${step.destroy}`, `build:${step.build}`);
		} else if (step.kind === 'range-interrupt') {
			choices.push(`range-interrupt:${rng.pick(NOTE_INTERRUPTS)}`);
		} else if (step.kind !== 'pause') choices.push(step.kind);
	}
	return choices;
}

describe('multi-seed coverage', () => {
	it('the seeds together draw every detour and every choice inside one', async () => {
		const every = [
			'select-delete',
			'copy-paste',
			'reorder',
			'merge',
			...FLIP_MODES.map((m) => `mode-flip:${m}`),
			...RANGE_DESTROYS.map((d) => `destroy:${d}`),
			...RANGE_BUILDS.map((b) => `build:${b}`),
			...NOTE_INTERRUPTS.map((g) => `range-interrupt:${g}`)
		];
		const drawn = new Set((await Promise.all(MULTI_SEEDS.map(choicesDrawn))).flat());
		expect(every.filter((choice) => !drawn.has(choice))).toEqual([]);
	});
});
