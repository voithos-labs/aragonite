// @vitest-environment jsdom
// A key that starts a typing run with the spell check on reads no whole document through it: no
// byte map pairing, no walk, no text read, and as many blocks measured, built and read at 400 as
// at 40.
// Miss-analysis: the typing pause was timed in a production page, never counted, so nothing said
// whether the plugin's own reads were part of it. Blocks built counted no `doc.walk()` past the
// first either, since a node's block is built once.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spellcheckPlugin } from '#packages/spellcheck/src/index.js';
import type { Dictionary } from '#packages/spellcheck/src/dictionary.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

const dictionary: Dictionary = { check: () => true, suggest: () => [] };

/** What the first key of a run in block 3 costs, a run in block 1 typed before it. */
async function runStartCost(n: number) {
	const source = Array.from({ length: n }, (_, i) => `line ${i}\n`).join('\n');
	const m = mountEditor({ source, plugins: [spellcheckPlugin({ dictionary })] });
	await m.settle();
	typeInto(surfaceAt(m, [1]), 'line 1x');
	await m.settle();
	resetPerfInstruments();
	enablePerfInstruments();
	typeInto(surfaceAt(m, [3]), 'line 3x');
	await m.settle();
	const { byteMapReads, documentWalks, textReads, topBlocksMeasured, blocksBuilt, blocksRead } =
		perfSnapshot();
	disablePerfInstruments();
	await m.destroy();
	return { byteMapReads, documentWalks, textReads, topBlocksMeasured, blocksBuilt, blocksRead };
}

describe('the spell check on a key that starts a typing run', () => {
	it('reads no whole document, at 40 blocks as at 400', async () => {
		const small = await runStartCost(40);
		expect(small).toMatchObject({ byteMapReads: 0, documentWalks: 0, textReads: 0 });
		expect(await runStartCost(400)).toEqual(small);
	});
});
