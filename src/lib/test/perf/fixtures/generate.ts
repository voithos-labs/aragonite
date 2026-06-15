/**
 * Deterministic markdown fixture generators for the perf harness.
 * Same (shape, targetBytes, seed) always yields identical bytes, so numbers
 * from different runs and machines stay comparable. `targetBytes` counts
 * UTF-16 code units, which equal bytes only while the corpus stays ASCII.
 */

export const FIXTURE_SHAPES = [
	'flat-prose',
	'nested-containers',
	'many-small-blocks',
	'single-giant-paragraph',
	'reference-heavy',
	'table-heavy'
] as const;
export type FixtureShape = (typeof FIXTURE_SHAPES)[number];

export function generateFixture(shape: FixtureShape, targetBytes: number, seed = 42): string {
	const rand = mulberry32(seed);
	const chunks: string[] = [];
	let size = 0;
	let i = 0;
	while (size < targetBytes) {
		const chunk = BUILDERS[shape](rand, i++);
		chunks.push(chunk);
		size += chunk.length;
	}
	return chunks.join('');
}

/**
 * `blockCount` plain paragraphs of `wordsPerBlock` words each. Varying
 * blockCount at fixed wordsPerBlock isolates mounted-block count; varying
 * wordsPerBlock at fixed blockCount isolates per-block content size.
 */
export function generateUniformBlocks(
	blockCount: number,
	wordsPerBlock: number,
	seed = 42
): string {
	const rand = mulberry32(seed);
	const out: string[] = [];
	for (let i = 0; i < blockCount; i++) out.push(words(rand, wordsPerBlock));
	return out.join('\n\n') + '\n';
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = [
	'alpha',
	'bravo',
	'charlie',
	'delta',
	'echo',
	'foxtrot',
	'golf',
	'hotel',
	'india',
	'juliet',
	'kilo',
	'lima',
	'mike',
	'november',
	'oscar',
	'papa'
];

function words(rand: () => number, n: number): string {
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(rand() * WORDS.length)]);
	return out.join(' ');
}

const BUILDERS: Record<FixtureShape, (rand: () => number, i: number) => string> = {
	'flat-prose': (rand) =>
		`## ${words(rand, 4)}\n\n` +
		`${words(rand, 20)} **${words(rand, 2)}** ${words(rand, 10)} \`${words(rand, 1)}\`.\n\n` +
		`${words(rand, 30)} *${words(rand, 3)}* ${words(rand, 15)}.\n\n`,

	'nested-containers': (rand) =>
		`- ${words(rand, 6)}\n` +
		`  - ${words(rand, 6)}\n` +
		`    - ${words(rand, 6)}\n` +
		`      - ${words(rand, 6)}\n` +
		`\n> ${words(rand, 8)}\n> > ${words(rand, 8)}\n\n`,

	'many-small-blocks': (rand) => `${words(rand, 4)}\n\n`,

	// The whole fixture is one paragraph: no newline until EOF, so every chunk
	// joins onto the same line.
	'single-giant-paragraph': (rand, i) => (i === 0 ? '' : ' ') + words(rand, 12),

	'reference-heavy': (rand, i) =>
		`${words(rand, 10)} [${words(rand, 2)}][ref-${i}] ${words(rand, 8)}.\n\n` +
		`[ref-${i}]: https://example.com/${i} "${words(rand, 2)}"\n\n`,

	'table-heavy': (rand) => {
		const row = () => `| ${words(rand, 2)} | ${words(rand, 2)} | ${words(rand, 2)} |\n`;
		let t = row() + '| --- | --- | --- |\n';
		for (let r = 0; r < 10; r++) t += row();
		return t + '\n';
	}
};
