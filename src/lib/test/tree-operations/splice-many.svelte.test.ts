import { describe, it, expect } from 'vitest';
import { spliceMany } from '$lib/tree-operations/splice-many';

/** Past the engine's argument limit, so a single spread would raise a RangeError here. */
const OVER_LIMIT = 200_000;

const run = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('spliceMany', () => {
	it.each([
		['head', 0],
		['middle', 2],
		['tail', 4]
	] as const)('inserts a document-scaled run at the %s', (_where, at) => {
		const target = run(4);
		const items = run(OVER_LIMIT);
		spliceMany(target, at, 0, items);
		expect(target).toHaveLength(4 + OVER_LIMIT);
		expect(target[at]).toBe(0);
		expect(target[at + OVER_LIMIT - 1]).toBe(OVER_LIMIT - 1);
		expect(target.slice(0, at)).toEqual(run(at));
		expect(target.slice(at + OVER_LIMIT)).toEqual(run(4).slice(at));
	});

	it('removes more than it writes back', () => {
		const target = run(10);
		spliceMany(target, 2, 6, [100, 101]);
		expect(target).toEqual([0, 1, 100, 101, 8, 9]);
	});

	it('with no items is a plain delete', () => {
		const target = run(5);
		spliceMany(target, 1, 2, []);
		expect(target).toEqual([0, 3, 4]);
	});

	it('clamps a start past the end, and reads a negative one from the end', () => {
		const appended = run(3);
		spliceMany(appended, 99, 0, [7, 8]);
		expect(appended).toEqual([0, 1, 2, 7, 8]);

		const fromEnd = run(3);
		spliceMany(fromEnd, -1, 1, [7, 8]);
		expect(fromEnd).toEqual([0, 1, 7, 8]);
	});

	it('keeps the array’s identity, so a holder of the reference sees the write', () => {
		const target = run(3);
		const alias = target;
		spliceMany(target, 1, 1, run(OVER_LIMIT));
		expect(alias).toBe(target);
		expect(alias).toHaveLength(2 + OVER_LIMIT);
	});

	it('writes through a $state proxy array the same way', () => {
		const proxied = $state([0, 1, 2]);
		spliceMany(proxied, 1, 1, [7, 8, 9]);
		expect(proxied).toEqual([0, 7, 8, 9, 2]);
	});
});
