// Property suites are fixed-seed by default so the commit gate is deterministic
// (a culture rule: the gate must reproduce, not flake). Threading every fc.assert
// site's seed through this helper opens ONE opt-in escape hatch: PROPERTY_FRESH=1
// swaps in a random seed for new-input discovery (the `test:editor:property:fresh`
// lane). The chosen seed is printed eagerly in fresh mode so a find is reproducible
// even if the run later crashes, and fast-check echoes the seed again in any
// failure message. Fixed mode prints nothing, keeping the gate output clean.
//
// The print goes to the raw stderr stream, not console.error: vitest intercepts
// console.* and drops module-load-time writes (this helper runs while PARAMS
// consts evaluate, before any test starts), so the stream write is what actually
// surfaces the seed.

const FRESH = process.env.PROPERTY_FRESH === '1' || process.env.PROPERTY_FRESH === 'true';

export function freshOrFixedSeed(fixedSeed: number): number {
	if (!FRESH) return fixedSeed;
	const seed = Math.floor(Math.random() * 0x1_0000_0000);
	process.stderr.write(`[property:fresh] seed ${seed} (fixed default ${fixedSeed})\n`);
	return seed;
}
