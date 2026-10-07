import type { Rng } from './rng';

// The typos a session's typing draws: the only draws a note's build makes, so a replay of the
// build needs nothing but this.

export const SESSION_TYPO_RATE = 0.15;

const KEY_NEIGHBORS: Record<string, string> = {
	a: 's',
	e: 'r',
	i: 'o',
	o: 'i',
	n: 'm',
	t: 'y',
	s: 'a',
	r: 'e'
};

/** The wrong key typed (and backspaced) before `ch`, or null when this character draws none. */
export function drawTypo(rng: Rng, typoRate: number, ch: string): string | null {
	if (typoRate <= 0 || !/[a-z]/i.test(ch) || !rng.chance(typoRate)) return null;
	const lower = ch.toLowerCase();
	const neighbor = KEY_NEIGHBORS[lower];
	if (neighbor) return ch === lower ? neighbor : neighbor.toUpperCase();
	return rng.pick(['x', 'z', 'q'] as const);
}
