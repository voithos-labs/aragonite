import { describe, it, expect } from 'vitest';
import { INSERT_CHUNK, spliceMany } from '$lib/tree-operations/splice-many';

/** Past the engine's argument limit, so a single spread would raise a RangeError here. */
const OVER_LIMIT = 200_000;

const run = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('spliceMany past the argument limit', () => {
	it.each([
		['at the head', 0, 0, 0],
		['in the middle', 2, 0, 2],
		['at the tail', 4, 0, 4],
		['over a wider delete', 1, 3, 1],
		['past the end', 99, 0, 4],
		['from a negative start', -1, 1, 3]
	] as const)('writes the whole list %s', (_label, at, deleteCount, landsAt) => {
		const target = run(4);
		const survivors = run(4);
		survivors.splice(landsAt, deleteCount);
		spliceMany(target, at, deleteCount, run(OVER_LIMIT));

		expect(target).toHaveLength(survivors.length + OVER_LIMIT);
		expect(target[landsAt]).toBe(0);
		expect(target[landsAt + OVER_LIMIT - 1]).toBe(OVER_LIMIT - 1);
		expect(target.slice(0, landsAt)).toEqual(survivors.slice(0, landsAt));
		expect(target.slice(landsAt + OVER_LIMIT)).toEqual(survivors.slice(landsAt));
	});

	// The seam between the one-call path and the chunk loop, where the loop's offset arithmetic
	// first has a second chunk to place.
	it.each([INSERT_CHUNK, INSERT_CHUNK + 1])('hands off at the ceiling with %i items', (count) => {
		const target = run(4);
		spliceMany(target, 2, 1, run(count));
		expect(target).toHaveLength(3 + count);
		expect(target.slice(2, 2 + count)).toEqual(run(count));
		expect(target.slice(2 + count)).toEqual([3]);
	});

	it('keeps the array’s identity, so a holder of the reference sees the write', () => {
		const target = run(3);
		const alias = target;
		spliceMany(target, 1, 1, run(OVER_LIMIT));
		expect(alias).toBe(target);
		expect(alias).toHaveLength(2 + OVER_LIMIT);
	});
});

describe('spliceMany under the argument limit', () => {
	it.each([
		['a plain insert', 1, 0, [7, 8]],
		['a replace', 1, 1, [7]],
		['a delete with no items', 1, 2, []],
		['a delete wider than the array', 2, 99, [7]],
		['a start past the end', 99, 0, [7]],
		['a negative start', -2, 1, [7, 8]]
	] as const)('leaves what splice itself leaves for %s', (_label, at, deleteCount, items) => {
		const target = run(5);
		const expected = run(5);
		expected.splice(at, deleteCount, ...items);
		spliceMany(target, at, deleteCount, items);
		expect(target).toEqual(expected);
	});

	it('writes through a $state proxy array', () => {
		const proxied = $state([0, 1, 2]);
		spliceMany(proxied, 1, 1, [7, 8, 9]);
		expect(proxied).toEqual([0, 7, 8, 9, 2]);
	});
});
