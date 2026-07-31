/**
 * The sole randomness source: a seed fully determines every draw, so a failing session
 * replays byte-for-byte. Nothing here may consult `Date.now` or `Math.random`.
 */

export interface Rng {
	int(minInclusive: number, maxExclusive: number): number;
	chance(p: number): boolean;
	pick<T>(items: readonly T[]): T;
	weightedPick<T>(items: readonly { value: T; weight: number }[]): T;
}

export function makeRng(seed: number): Rng {
	let state = seed >>> 0;
	const next = (): number => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (minInclusive: number, maxExclusive: number): number =>
		minInclusive + Math.floor(next() * (maxExclusive - minInclusive));
	return {
		int,
		chance: (p) => next() < p,
		pick: (items) => items[int(0, items.length)],
		weightedPick: (items) => {
			const total = items.reduce((sum, item) => sum + item.weight, 0);
			let threshold = next() * total;
			for (const item of items) {
				threshold -= item.weight;
				if (threshold < 0) return item.value;
			}
			return items[items.length - 1].value;
		}
	};
}
