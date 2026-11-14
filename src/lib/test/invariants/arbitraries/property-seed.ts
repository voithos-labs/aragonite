// Property suites run on a fixed seed so the commit gate reproduces instead of flaking. Routing
// every `fc.assert` seed through here leaves one opt-in way to draw fresh inputs (the
// `test:editor:property:fresh` script) and one to replay a printed seed (`PROPERTY_SEED`), and the
// seed is printed immediately so a find survives a later crash. Written to stderr rather than
// `console.error`, because Vitest drops console writes made while a module loads, and this runs
// while the `PARAMS` constants evaluate.

const FRESH = process.env.PROPERTY_FRESH === '1' || process.env.PROPERTY_FRESH === 'true';
const REPLAY = process.env.PROPERTY_SEED;

export function freshOrFixedSeed(fixedSeed: number): number {
	if (REPLAY) return replayed(REPLAY);
	if (!FRESH) return fixedSeed;
	const seed = Math.floor(Math.random() * 0x1_0000_0000);
	process.stderr.write(`[property:fresh] seed ${seed} (fixed default ${fixedSeed})\n`);
	return seed;
}

// fast-check takes any number as a seed, so a mistyped one would replay nothing without a word.
function replayed(text: string): number {
	const seed = Number(text);
	if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(seed)) {
		throw new Error(
			`PROPERTY_SEED must be an integer, as a run prints it; got ${JSON.stringify(text)}`
		);
	}
	return seed;
}
