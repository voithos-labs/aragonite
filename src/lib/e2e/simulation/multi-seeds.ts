import { makeRng } from './rng';
import { SESSION_TYPO_RATE, drawTypo } from './typos';
import { planDetours, type SessionDraws } from './detour-plan';
import { MEETING_MINUTES_NOTE } from './notes/meeting-minutes-note';
import type { Gestures } from './gestures';
import type { RangeInterruptGesture } from './gestures/range-interrupt';

// The seeds the multi-seed spec runs the meeting-minutes note on, and an offline replay of what each
// draws. The spec holds every live session to its replay; `seed-coverage.test.ts` checks that
// together the replays draw every detour choice.

export const MULTI_SEEDS = [2, 3, 12, 19, 5] as const;

/** What `availableRangeInterrupts` reads off the built note: no image, a prose last block, and no
 *  drag handle, since every block in it is prose. */
export const NOTE_INTERRUPTS: readonly RangeInterruptGesture[] = [
	'dead-space-margin',
	'escape',
	'dead-space-below',
	'search-round-trip'
];

/** The build draws only typos, so a stand-in whose other gestures do nothing replays it exactly. */
export async function replayDraws(seed: number): Promise<SessionDraws> {
	const rng = makeRng(seed);
	const typeText = async (text: string) => {
		for (const ch of text) drawTypo(rng, SESSION_TYPO_RATE, ch);
	};
	const stub = new Proxy({} as Gestures, {
		get: (_, name) => (name === 'typeText' ? typeText : async () => {})
	});
	await MEETING_MINUTES_NOTE.build(stub);

	const plan = planDetours(rng);
	if (!plan.some((step) => step.kind === 'range-interrupt')) {
		return { plan, interrupts: null, interrupt: null };
	}
	return { plan, interrupts: NOTE_INTERRUPTS, interrupt: rng.pick(NOTE_INTERRUPTS) };
}
