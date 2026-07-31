// Property suites are fixed-seed so the commit gate reproduces rather than flakes.
// Threading every fc.assert seed through here opens ONE opt-in escape hatch for new-input
// discovery (the `test:editor:property:fresh` lane), printed eagerly so a find survives a
// later crash. Raw stderr, not console.error: vitest drops module-load-time console.*
// writes, and this runs while the PARAMS consts evaluate.

const FRESH = process.env.PROPERTY_FRESH === '1' || process.env.PROPERTY_FRESH === 'true';

export function freshOrFixedSeed(fixedSeed: number): number {
	if (!FRESH) return fixedSeed;
	const seed = Math.floor(Math.random() * 0x1_0000_0000);
	process.stderr.write(`[property:fresh] seed ${seed} (fixed default ${fixedSeed})\n`);
	return seed;
}
