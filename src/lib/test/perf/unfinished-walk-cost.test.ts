// A keystroke walks the body for a construct it could finish only when it wrote a line that
// could finish one, and then walks once, whatever the number of openers.
// Miss-analysis: the closer two blocks below (#684) needed a walk up the body, and no row said
// which keystrokes pay for it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { unfinishedReadings, type UnfinishedReading } from '#lib/schema/block-openers.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { installPlugins } from '#lib';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { detailsPlugin } from '#lib/plugins/details/index.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

const BLOCKS = 5000;
const BODY = Array.from({ length: BLOCKS }, (_, i) => `paragraph ${i}\n`).join('\n');

/** What the openers' declarations were asked when `text` is written in place over block `index`:
 *  the blocks asked whether they wait, and how many questions of either kind were asked. */
function walkOf(text: string, index = BLOCKS - 1, body = BODY) {
	const { deps } = makeEditorActionsDeps(body);
	const typing = createUndoController(deps);
	const write = legalizeWrite(deps.doc, index, text, 'authored');
	const readings = unfinishedReadings(deps.reading.grammar) as UnfinishedReading[];
	const saved = readings.map((reading) => ({ ...reading }));
	const blocks = new Set<string>();
	let asked = 0;
	readings.forEach((reading, k) => {
		reading.notFinal = (raw) => (blocks.add(raw), asked++, saved[k].notFinal(raw));
		reading.mayClose = (line) => (asked++, saved[k].mayClose(line));
	});
	try {
		expect(typing.typeLeaf(docPathFrom([index]), write, 0).wrote).toBe(true);
	} finally {
		readings.forEach((reading, k) => Object.assign(reading, saved[k]));
	}
	return { blocks: [...blocks], asked, readings: readings.length };
}

/** Whether only block `index` (as it stood, or as `written`) and its neighbours were asked. */
const askedNear = (blocks: string[], index: number, written = '') =>
	blocks.every(
		(raw) =>
			raw === written || [index - 1, index, index + 1].some((i) => raw.startsWith(`paragraph ${i}`))
	);

beforeEach(() => {
	installPlugins([latexPlugin(), admonitionsPlugin(), detailsPlugin()]);
	resetPerfInstruments();
});
afterEach(() => disablePerfInstruments());

describe('the walk for a construct a keystroke could finish, over a 5,000-block body', () => {
	it('a letter that closes nothing reads no block above', () => {
		expect(askedNear(walkOf(`paragraph ${BLOCKS - 1}x\n`).blocks, BLOCKS - 1)).toBe(true);
	});

	// Each block above is asked by each declaration at most once: one walk, not one per opener.
	it.each(['$$', ':::', '</details>'])('a `%s` line walks the body once', (closer) => {
		const { blocks, asked, readings } = walkOf(`paragraph\n${closer}\n`);
		expect(blocks.length).toBeGreaterThanOrEqual(BLOCKS);
		expect(asked).toBeLessThan(readings * (BLOCKS + 10));
	});

	it('a letter on the first line of a block waiting on nothing reads no block below', () => {
		expect(askedNear(walkOf('paragraph 0x\n', 0).blocks, 0)).toBe(true);
	});

	// The one keystroke that pays for the body: a first line left waiting reads down to a closer.
	it('a first line left waiting on a closer reads every block below once', () => {
		const { asked } = walkOf('$$\n', 0, `x$$\n\n${BODY}`);
		// Each block below holds one line, asked once by the one declaration waiting on it.
		expect(asked).toBeGreaterThanOrEqual(BLOCKS);
		expect(asked).toBeLessThan(2 * BLOCKS);
	});

	// An unclosed fence takes every line below it, so none stands above the line a keystroke wrote.
	it('a bare fence line typed at the end of the body reads no block above', () => {
		expect(askedNear(walkOf('```\n').blocks, BLOCKS - 1, '```\n')).toBe(true);
	});

	it('an opener broken above the body reads the body into its closer in one pass', () => {
		const source = `\`\`\`js\ncode\n\`\`\`\n\n${BODY}`;
		const { deps } = makeEditorActionsDeps(source);
		const typing = createUndoController(deps);
		const write = legalizeWrite(deps.doc, 0, '``js\ncode\n```\n', 'authored');
		enablePerfInstruments();
		resetPerfInstruments();
		typing.typeLeaf(docPathFrom([0]), write, 0);

		expect(deps.doc.children).toHaveLength(2);
		expect(perfSnapshot().parseBytes).toBeLessThan(4 * source.length);
	});
});
