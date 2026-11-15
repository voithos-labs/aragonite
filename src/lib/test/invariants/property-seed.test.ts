// Miss-analysis: nothing read the replay seed but fast-check, which took `NaN` without a word.
import { afterEach, describe, expect, it, vi } from 'vitest';

async function seedWith(replay: string): Promise<() => number> {
	vi.stubEnv('PROPERTY_SEED', replay);
	vi.resetModules();
	const { freshOrFixedSeed } = await import('./arbitraries/property-seed');
	return () => freshOrFixedSeed(424242);
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe('PROPERTY_SEED', () => {
	it.each(['3203269577', '-1091697719'])('replays the integer %s', async (replay) => {
		expect((await seedWith(replay))()).toBe(Number(replay));
	});

	it.each(['abc', '12.5', '1e400', ' '])('refuses %j loudly', async (replay) => {
		expect(await seedWith(replay)).toThrow(/PROPERTY_SEED/);
	});
});
