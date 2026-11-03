// A keystroke walks the body for a construct it could finish only when it wrote a line that
// could finish one, and then walks once, whatever the number of openers.
// Miss-analysis: the closer two blocks below (#684) needed a walk up the body, and no row said
// which keystrokes pay for it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import {
	defaultGrammarView,
	unfinishedReadings,
	type UnfinishedReading
} from '#lib/schema/block-openers.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import type { EditorActionsDeps } from '#lib/editor-actions/deps.js';
import { readBack } from '#lib/core/inline/live-edit/read-back.js';
import { storedAsAt } from '#lib/tree-operations/stored-as.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { installPlugins } from '#lib';
import { latexPlugin } from '#packages/latex/src/index.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
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
	return asking(body, (deps) => {
		const typing = createUndoController(deps);
		// Made legal inside the count, since the closer it may add reads the body below.
		const write = legalizeWrite(deps.doc, index, text, 'authored', defaultGrammarView);
		expect(typing.typeLeaf(docPathFrom([index]), write, 0).wrote).toBe(true);
	});
}

/** What the openers' declarations were asked while `run` ran over `body`. */
function asking(body: string, run: (deps: EditorActionsDeps) => void) {
	const { deps } = makeEditorActionsDeps(body);
	const readings = unfinishedReadings(deps.reading.grammar) as UnfinishedReading[];
	const saved = readings.map((reading) => ({ ...reading }));
	const blocks = new Set<string>();
	let asked = 0;
	readings.forEach((reading, k) => {
		reading.notFinal = (raw) => (blocks.add(raw), asked++, saved[k].notFinal(raw));
		reading.mayClose = (line) => (asked++, saved[k].mayClose(line));
	});
	try {
		run(deps);
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

	// Live mode reads each keystroke's candidate back through the slot's store, which makes it legal.
	it('a live-mode keystroke in prose reads no block below its read-back', () => {
		const { blocks } = asking(BODY, (deps) => {
			const store = storedAsAt(deps.doc, [0], fixtureReading({}, 'live'));
			enablePerfInstruments();
			resetPerfInstruments();
			readBack('paragraph 0x\n', store);
		});
		expect(askedNear(blocks, 0)).toBe(true);
		expect(perfSnapshot().parseBytes).toBeLessThan(BODY.length / 10);
	});

	// The one keystroke that pays for the body: a first line left waiting reads down for a closer,
	// once for the closer the write would give it and once for the walk.
	it('a first line left waiting on a closer reads every block below twice', () => {
		const { asked } = walkOf('$$\n', 0, `x$$\n\n${BODY}`);
		// Each block below holds one line, asked once a pass by the one declaration waiting on it.
		expect(asked).toBeGreaterThanOrEqual(2 * BLOCKS);
		expect(asked).toBeLessThan(3 * BLOCKS);
	});

	// An unclosed fence takes every line below it, so none stands above the line a keystroke wrote.
	it('a bare fence line typed at the end of the body reads no block above', () => {
		expect(askedNear(walkOf('```\n').blocks, BLOCKS - 1, '```\n')).toBe(true);
	});

	it('an opener broken above the body reads the body into its closer in one pass', () => {
		const source = `\`\`\`js\ncode\n\`\`\`\n\n${BODY}`;
		const { deps } = makeEditorActionsDeps(source);
		const typing = createUndoController(deps);
		const write = legalizeWrite(deps.doc, 0, '``js\ncode\n```\n', 'authored', defaultGrammarView);
		enablePerfInstruments();
		resetPerfInstruments();
		typing.typeLeaf(docPathFrom([0]), write, 0);

		expect(deps.doc.children).toHaveLength(2);
		expect(perfSnapshot().parseBytes).toBeLessThan(4 * source.length);
	});
});
