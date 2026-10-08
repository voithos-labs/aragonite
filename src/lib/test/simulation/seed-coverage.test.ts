// Miss-analysis: nothing replayed the multi-seed draws, so no one saw its eight seeds never draw
// three of the destroys, the Shift+click build or the margin click.
import { describe, it, expect } from 'vitest';
import {
	FLIP_MODES,
	RANGE_BUILDS,
	RANGE_DESTROYS,
	type SessionDraws
} from '#lib/e2e/simulation/detour-plan.js';
import { MULTI_SEEDS, NOTE_INTERRUPTS, replayDraws } from '#lib/e2e/simulation/multi-seeds.js';

function choicesIn({ plan, interrupt }: SessionDraws): string[] {
	const choices: string[] = [];
	for (const step of plan) {
		if (step.kind === 'mode-flip') choices.push(`mode-flip:${step.mode}`);
		else if (step.kind === 'cross-block') {
			choices.push(`destroy:${step.destroy}`, `build:${step.build}`);
		} else if (step.kind === 'range-interrupt') choices.push(`range-interrupt:${interrupt}`);
		else if (step.kind !== 'pause') choices.push(step.kind);
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
		const replays = await Promise.all(MULTI_SEEDS.map(replayDraws));
		const drawn = new Set(replays.flatMap(choicesIn));
		expect(every.filter((choice) => !drawn.has(choice))).toEqual([]);
	});
});
