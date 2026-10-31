// Miss-analysis: nothing compiled the guide's parrot sample, so a barrel rename broke it unseen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pluginGuidePages } from '../../invariants/lint/scan-source';

/**
 * The shipped parrot is the plugin guide's quickstart, file for file, with the frames doc's
 * canonical ten where the guide shows two; derived from the docs so either side drifting fails here.
 */

const PLUGIN_DIR = 'packages/parrot/src';

const PLUGIN_MARKER = '// parrot-plugin.ts';
const STYLES_MARKER = '/* parrot.css */';
const SAMPLE_MARKER = '// parrot-frames.ts';
const FRAMES_MARKER = '// The canonical ten, via terminal-parrot (MIT).';

const read = (rel: string) => readFileSync(path.resolve(rel), 'utf8');

/** The one guide page holding `markerLine`, so a section can move between the guide's pages. */
function pageHolding(markerLine: string): string {
	const holders = pluginGuidePages()
		.map(read)
		.filter((page) => page.split('\n').includes(markerLine));
	expect(holders, `guide pages holding: ${markerLine}`).toHaveLength(1);
	return holders[0];
}

// ── The extractor ────────────────────────────────────────────────────────────

const FENCE_OPEN = /^\s*(`{3,})/;

/**
 * The fence whose body holds `markerLine`, found by marker so an edit elsewhere cannot retarget
 * it. Prettier may lengthen a fence, so any backtick run opens one and a run as long closes it.
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

const fenceIn = (markerLine: string) => fenceBodyAround(pageHolding(markerLine), markerLine);

/** Each `String.raw` frame of a frames file, its closing delimiter left off so a frame reads the
 *  same whether it ends the array or not. */
function framesOf(file: string): string[] {
	return file
		.split('\tString.raw`')
		.slice(1)
		.map((frame) => frame.slice(0, frame.lastIndexOf('`')));
}

// ── The drift gate ───────────────────────────────────────────────────────────

describe('the bundled parrot is the plugin guide, compiled', () => {
	it('matches the plugin fence byte for byte', () => {
		expect(read(`${PLUGIN_DIR}/parrot-plugin.ts`)).toBe(fenceIn(PLUGIN_MARKER));
	});

	it('matches the stylesheet fence byte for byte', () => {
		expect(read(`${PLUGIN_DIR}/parrot.css`)).toBe(fenceIn(STYLES_MARKER));
	});

	it("matches the frames doc's canonical ten byte for byte", () => {
		expect(read(`${PLUGIN_DIR}/parrot-frames.ts`)).toBe(fenceIn(FRAMES_MARKER));
	});

	it("shows frames 0 and 5 of the ten in the guide, in the shipped file's shape", () => {
		const sample = fenceIn(SAMPLE_MARKER);
		const canonical = framesOf(fenceIn(FRAMES_MARKER));
		expect(framesOf(sample)).toEqual([canonical[0], canonical[5]]);
		expect(sample).toContain('\nexport const PARROT_FRAMES = [\n\tString.raw`');
		expect(sample.endsWith('`\n];\n')).toBe(true);
	});
});

// ── Non-vacuity ──────────────────────────────────────────────────────────────

describe('the frames reader is not vacuous', () => {
	it('reads ten frames from the doc and two from the guide, art untouched', () => {
		const canonical = framesOf(fenceIn(FRAMES_MARKER));
		expect(canonical).toHaveLength(10);
		expect(framesOf(fenceIn(SAMPLE_MARKER))).toHaveLength(2);
		// A frame's last art row sits at column 0: a stray tab would paint a column down the bird.
		expect(canonical[0]).toContain('\ncNO;........................................\n');
	});
});
