import { describe, expect, test } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { FIXTURE_SHAPES, generateFixture } from './generate';

describe('fixture generators', () => {
	for (const shape of FIXTURE_SHAPES) {
		test(`${shape}: deterministic for same seed`, () => {
			expect(generateFixture(shape, 100_000, 7)).toBe(generateFixture(shape, 100_000, 7));
		});

		test(`${shape}: different seed differs`, () => {
			expect(generateFixture(shape, 100_000, 7)).not.toBe(generateFixture(shape, 100_000, 8));
		});

		test(`${shape}: size lands in [target, target * 1.1]`, () => {
			const out = generateFixture(shape, 100_000, 7);
			expect(out.length).toBeGreaterThanOrEqual(100_000);
			expect(out.length).toBeLessThanOrEqual(110_000);
		});

		test(`${shape}: round-trips losslessly`, () => {
			const src = generateFixture(shape, 100_000, 7);
			expect(serialize(parse(src))).toBe(src);
		});
	}
});
