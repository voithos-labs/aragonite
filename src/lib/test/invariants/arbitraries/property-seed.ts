// Property suites run on a fixed seed so the commit gate reproduces instead of flaking. Routing
// every `fc.assert` seed through here leaves one opt-in way to draw fresh inputs (the
// `test:editor:property:fresh` script), and the seed is printed immediately so a find survives a
// later crash. Written to stderr rather than `console.error`, because Vitest drops console writes
// made while a module loads, and this runs while the `PARAMS` constants evaluate.

const FRESH = process.env.PROPERTY_FRESH === '1' || process.env.PROPERTY_FRESH === 'true';

export function freshOrFixedSeed(fixedSeed: number): number {
	if (!FRESH) return fixedSeed;
	const seed = Math.floor(Math.random() * 0x1_0000_0000);
	process.stderr.write(`[property:fresh] seed ${seed} (fixed default ${fixedSeed})\n`);
	return seed;
}
