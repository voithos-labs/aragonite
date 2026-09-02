// Miss-analysis: the plugin guide's parrot sample compiled only when a human filmed it, so
// nothing caught a barrel rename or a runes change that broke the quickstart a reader copies.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The shipped parrot IS the guide's quickstart: `docs/guide/plugin-guide.md` owns the bytes,
 * `src/lib/plugins/parrot/` compiles them. Two adaptations bridge the two, and this derives
 * the plugin from the docs so either side drifting reds here rather than in a reader's editor.
 */

const PLUGIN_DIR = 'src/lib/plugins/parrot';
const GUIDE = 'docs/guide/plugin-guide.md';
const FRAMES_DOC = 'docs/guide/plugin-guide/parrot-frames.md';

const PLUGIN_MARKER = '// parrot-plugin.ts';
const COMPONENT_MARKER = '<!-- ParrotBlock.svelte -->';
const FRAMES_MARKER = '// The canonical ten, via terminal-parrot (MIT).';

const read = (rel: string) => readFileSync(path.resolve(rel), 'utf8');

// ── The extractor ────────────────────────────────────────────────────────────

const FENCE_OPEN = /^\s*(`{3,})/;

/**
 * The fence whose body holds `markerLine`, located by that marker rather than by index so
 * an edit elsewhere in the guide cannot silently retarget it. Any backtick run opens a
 * fence (Prettier promotes one whose body holds triple backticks) and the closer must be at
 * least as long.
 */
function fenceBodyAround(markdown: string, markerLine: string): string {
	const lines = markdown.split('\n');
	const at = lines.indexOf(markerLine);
	expect(at, `marker line not found: ${markerLine}`).toBeGreaterThan(-1);

	let open = -1;
	for (let i = at - 1; i >= 0; i--) {
		if (FENCE_OPEN.test(lines[i])) {
			open = i;
			break;
		}
	}
	expect(open, `no opening fence above: ${markerLine}`).toBeGreaterThan(-1);
	const ticks = lines[open].match(FENCE_OPEN)![1];

	let close = -1;
	for (let i = at + 1; i < lines.length; i++) {
		const run = lines[i].match(/^\s*(`{3,})\s*$/);
		if (run && run[1].length >= ticks.length) {
			close = i;
			break;
		}
	}
	expect(close, `no closing fence below: ${markerLine}`).toBeGreaterThan(-1);
	return lines.slice(open + 1, close).join('\n') + '\n';
}

function spanBetween(lines: string[], startLine: string, endLine: string) {
	const start = lines.indexOf(startLine);
	expect(start, `no line ${JSON.stringify(startLine)}`).toBeGreaterThan(-1);
	const end = lines.indexOf(endLine, start + 1);
	expect(end, `no line ${JSON.stringify(endLine)} after it`).toBeGreaterThan(-1);
	return { start, end };
}

/**
 * One tab onto the lines that are code. Every byte inside a `String.raw` literal keeps its
 * own indentation, its closing delimiter line included: a tab before that backtick lands
 * INSIDE the string and repaints the bird.
 */
function nestOneLevel(block: string[]): string[] {
	let inRaw = false;
	return block.map((line) => {
		if (inRaw) {
			if (line === '`,' || line === '`') inRaw = false;
			return line;
		}
		if (/String\.raw`$/.test(line)) inRaw = true;
		return line === '' ? line : `\t${line}`;
	});
}

/** Adaptation (a): a bundled plugin authors against the in-repo barrel alias (G4.16). */
const toLibImport = (code: string) =>
	code.replaceAll("'@voithos-labs/aragonite/plugin'", "'$lib/plugin'");

function derivePluginModule(guide: string): string {
	return toLibImport(fenceBodyAround(guide, PLUGIN_MARKER));
}

/**
 * Adaptation (b): the guide's two sample frames, comment included, become the frames doc's
 * canonical ten under that doc's own comment, so the shipped file never claims to hold two.
 */
const SAMPLE_COMMENT =
	'\t// Frames 0 and 5 of the canonical ten. The full dance is in ./plugin-guide/parrot-frames.md;';

function deriveComponent(guide: string, framesDoc: string): string {
	const component = toLibImport(fenceBodyAround(guide, COMPONENT_MARKER)).split('\n');
	const frames = fenceBodyAround(framesDoc, FRAMES_MARKER).split('\n');

	const canonical = spanBetween(frames, FRAMES_MARKER, '];');
	const sample = spanBetween(component, SAMPLE_COMMENT, '\t];');
	return [
		...component.slice(0, sample.start),
		...nestOneLevel(frames.slice(canonical.start, canonical.end + 1)),
		...component.slice(sample.end + 1)
	].join('\n');
}

// ── The drift gate ───────────────────────────────────────────────────────────

describe('the bundled parrot is the plugin guide, compiled', () => {
	const guide = read(GUIDE);
	const framesDoc = read(FRAMES_DOC);

	it('matches the guide fence byte for byte, barrel import aside', () => {
		expect(read(`${PLUGIN_DIR}/parrot-plugin.ts`)).toBe(derivePluginModule(guide));
	});

	it('matches the component fence byte for byte, with the canonical ten spliced in', () => {
		expect(read(`${PLUGIN_DIR}/ParrotBlock.svelte`)).toBe(deriveComponent(guide, framesDoc));
	});
});

// ── Non-vacuity: the derivation really does both adaptations ────────────────
// Two byte-equal sides prove nothing about WHICH bytes, and the splice is the half that
// can be wrong in the file and the derivation at once.

describe('the derivation performs both adaptations', () => {
	const guide = read(GUIDE);
	const framesDoc = read(FRAMES_DOC);

	it('rewrites the published specifier to the in-repo barrel', () => {
		const derived = derivePluginModule(guide);
		expect(fenceBodyAround(guide, PLUGIN_MARKER)).toContain("'@voithos-labs/aragonite/plugin'");
		expect(derived).toContain("from '$lib/plugin'");
		expect(derived).not.toContain('@voithos-labs/aragonite');
	});

	it('splices ten frames where the guide shows two', () => {
		expect(fenceBodyAround(guide, COMPONENT_MARKER).match(/String\.raw`/g)).toHaveLength(2);
		expect(deriveComponent(guide, framesDoc).match(/String\.raw`/g)).toHaveLength(10);
	});

	it("swaps the two-frame comment for the frames doc's own", () => {
		const derived = deriveComponent(guide, framesDoc);
		expect(derived).not.toContain('Frames 0 and 5');
		expect(derived).toContain(`\t${FRAMES_MARKER}\n\tconst FRAMES = [`);
	});

	it('nests the array one level without touching a byte of the art', () => {
		const derived = deriveComponent(guide, framesDoc);
		expect(derived).toContain('\tconst FRAMES = [\n\t\tString.raw`\n');
		// A frame's last art row and its closing delimiter, both at column 0 in the frames
		// doc: one leading tab here would paint a stray column down the whole bird.
		expect(derived).toContain(
			'\ncNO;........................................\n`,\n\t\tString.raw`\n'
		);
	});
});
