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
	'table-heavy',
	'giant-single-list',
	'giant-single-blockquote',
	'giant-single-table'
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

/**
 * One deep container spine of `depth` alternating blockquote/list levels, where
 * EVERY level carries `bytesPerLevel` of sibling content beside the descent —
 * so the outermost container's raw materializes the whole subtree and an
 * ancestry rebuild pays Σ over levels (write-amplification ≈ depth/2).
 *
 * The combined axis the per-axis benches miss: `nested-containers` gives depth
 * with tiny raws, `singleFlatList` gives breadth at depth 1. Parameterized like
 * `generateUniformBlocks` (independent depth × bytes) rather than a
 * `FIXTURE_SHAPES` entry, whose single `targetBytes` knob can express neither
 * axis and would sweep an unproven shape into the perf gate.
 *
 * Built inside-out: each level wraps the deeper content with the serializer's
 * own prefix transform (blockquote `> `/`>`, list-item `- `/`  `), so the
 * result round-trips by construction. Odd levels are blockquotes, even levels
 * lists — a list level parses to a `list` wrapping one `listItem`, so it adds
 * two containers to the rebuild chain, not one (the chain the ancestry rebuild
 * actually walks runs ~1.5× the wrap depth). The deepest leaf is a small plain
 * paragraph — the typeable caret target; {@link deepNestedLeafPath} addresses it.
 */
export function generateDeepNested(depth: number, bytesPerLevel: number, seed = 42): string {
	const rand = mulberry32(seed);
	const wordsPerLevel = Math.max(1, Math.round(bytesPerLevel / BYTES_PER_WORD));
	let content = words(rand, 3);
	for (let level = depth; level >= 1; level--) {
		const inner = words(rand, wordsPerLevel) + '\n\n' + content;
		content = level % 2 === 1 ? wrapBlockquote(inner) : wrapListItem(inner);
	}
	return content + '\n';
}

export const TRIGGER_DENSE_KINDS = ['bracket-footnote', 'colon', 'dollar'] as const;
export type TriggerDenseKind = (typeof TRIGGER_DENSE_KINDS)[number];

/**
 * Prose dense in one INLINE TRIGGER, for the report-only rows that measure what an
 * installed inline rung costs. Deliberately not a `FIXTURE_SHAPES` entry (the
 * {@link generateDeepNested} precedent): those sweep into every gated row, and these
 * shapes gate nothing — a rung's cost is a plugin's business, not a ceiling the
 * editor owes.
 *
 * - `bracket-footnote` — every paragraph carries inline links, a shortcut reference
 *   and a `[^label]` footnote reference, so each `[` in a scanned range pays the
 *   footnotes rung's prefix consultation. It carries a SECOND, unrelated cost by
 *   design: a mounted reference re-derives its number from a walk over the whole
 *   document on every content version, so this one fixture measures the scanner
 *   consultation and the mounted derivation together. No definitions — numbering is
 *   by first-reference order, so the widget renders a number without them, while
 *   `[^label]:` lines would parse as link reference definitions on the rung-free
 *   control route and measure a different document there.
 * - `colon` — shell/API prose whose colons mostly DECLINE (`Note:`, `ns::method`,
 *   clock times) plus one real shortcode per paragraph, since the emoji rung's cost
 *   is dominated by attempts that fail.
 * - `dollar` — shell-documentation prose (`$HOME $PATH $USER`), the issues.md
 *   example, plus one real math span in the first paragraph only: enough to prove the
 *   latex rung is live on the route, without making the row measure KaTeX renders.
 */
export function generateTriggerDense(
	kind: TriggerDenseKind,
	targetBytes: number,
	seed = 42
): string {
	const rand = mulberry32(seed);
	const chunks: string[] = [];
	let size = 0;
	let i = 0;
	while (size < targetBytes) {
		const chunk = TRIGGER_DENSE_BUILDERS[kind](rand, i++);
		chunks.push(chunk);
		size += chunk.length;
	}
	return chunks.join('');
}

/**
 * Path to the deepest (typeable) leaf of a `generateDeepNested(depth, …)` doc.
 * Each level descends to its spine child: a blockquote's is the second child
 * (after the sibling); a list's lives one hop deeper, inside the lone listItem.
 */
export function deepNestedLeafPath(depth: number): number[] {
	const path = [0];
	for (let level = 1; level <= depth; level++) {
		if (level % 2 === 1) path.push(1);
		else path.push(0, 1);
	}
	return path;
}

// `words()` yields ~6.1 B/token (5.1-char mean corpus word + one separator); the
// divisor rounds up to 7, so `bytesPerLevel` is a NOMINAL target the fixtures
// under-fill by ~12% (a true 50 KB/level would cost marginally more — still
// floor-class, so the shortfall is conservative for the concern-4 verdict).
const BYTES_PER_WORD = 7;

function wrapBlockquote(inner: string): string {
	return inner
		.split('\n')
		.map((line) => (line === '' ? '>' : '> ' + line))
		.join('\n');
}

function wrapListItem(inner: string): string {
	return inner
		.split('\n')
		.map((line, i) => (i === 0 ? '- ' + line : line === '' ? '' : '  ' + line))
		.join('\n');
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

const SHORTCODES = ['tada', 'rocket', 'bug', 'book', 'warning', 'smile'];

const TRIGGER_DENSE_BUILDERS: Record<TriggerDenseKind, (rand: () => number, i: number) => string> =
	{
		'bracket-footnote': (rand, i) =>
			`${words(rand, 8)} [${words(rand, 2)}](https://example.com/${i}) ${words(rand, 5)}[^fn-${i}] ` +
			`${words(rand, 6)} [${words(rand, 2)}][ref-${i}] ${words(rand, 5)}.\n\n`,

		colon: (rand, i) =>
			`${words(rand, 1)}: ${words(rand, 6)} ${words(rand, 1)}::${words(rand, 1)} ` +
			`at 1${i % 10}:${(i * 7) % 60} ${words(rand, 5)} :${SHORTCODES[i % SHORTCODES.length]}: ` +
			`${words(rand, 5)}.\n\n`,

		dollar: (rand, i) =>
			`${words(rand, 6)} $HOME $PATH $USER ${words(rand, 5)} $${i} ${words(rand, 6)}` +
			(i === 0 ? ' $a + b$' : '') +
			` ${words(rand, 5)}.\n\n`
	};

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
	},

	// One tight-list item per chunk, no blank line between -> a single `list` node
	// with thousands of `listItem` children.
	'giant-single-list': (rand) => `- ${words(rand, 6)}\n`,

	// One quoted paragraph per chunk; the bare `>` lazy-continuation line keeps
	// them inside ONE `blockquote` node with many paragraph children.
	'giant-single-blockquote': (rand) => `> ${words(rand, 8)}\n>\n`,

	// One table: header + delimiter on the first chunk, one body row per chunk
	// after, no blank line between -> a single `table` node with thousands of
	// `tableRow` children (rendered by TableBlock's own {#each}, bypassing BlockList).
	'giant-single-table': (rand, i) => {
		const row = () => `| ${words(rand, 2)} | ${words(rand, 2)} | ${words(rand, 2)} |\n`;
		return i === 0 ? row() + '| --- | --- | --- |\n' + row() : row();
	}
};
