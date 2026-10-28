// A keystroke in a GitHub alert or a footnote definition reads the same lines of it whatever its
// length: the bundled strip containers rebuild through the quote's and list item's line pairing.
// Miss-analysis: no perf row types inside an alert or a footnote, so a rebuild that fell back to
// writing every line per key would have passed every gate.
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installPlugins } from '#lib';
import type { CstNode } from '#lib/core/nodes.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

const TARGET = 10;

const CONTAINERS: { name: string; source: (paragraphs: number) => string }[] = [
	{
		name: 'a GitHub alert',
		source: (n) => '> [!NOTE]\n' + Array.from({ length: n }, (_, i) => `>line ${i}\n`).join('>\n')
	},
	{
		name: 'a footnote definition',
		// Tab-indented, a spelling the rebuild doesn't write, so every line it rewrites is read.
		source: (n) =>
			'[^1]: line 0\n' + Array.from({ length: n - 1 }, (_, i) => `\n\tline ${i + 1}\n`).join('')
	}
];

/** Strip lines read by the second of two keystrokes in the container's tenth paragraph; the
 *  first after a load writes every line's region down. */
function linesRead(source: string): number {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createUndoController(deps);
	for (let n = 0; n < 2; n++) {
		if (n === 1) {
			resetPerfInstruments();
			enablePerfInstruments();
		}
		const owner = blockNodeAt(deps.doc, [0]) as CstNode;
		const raw = owner.children![TARGET].raw;
		const at = raw.indexOf('\n');
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
		const write = legalizeWrite(
			body,
			TARGET,
			raw.slice(0, at) + 'Q' + raw.slice(at),
			'authored',
			defaultGrammarView
		);
		expect(typing.typeLeaf(docPathFrom([0, TARGET]), write, at + 1).wrote).toBe(true);
	}
	return perfSnapshot().stripLinesRead;
}

beforeEach(() => {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
	resetPerfInstruments();
});
afterEach(() => disablePerfInstruments());

describe('a keystroke in a bundled strip container', () => {
	for (const { name, source } of CONTAINERS) {
		it(`in ${name}, 40 body lines or 400`, () => {
			const few = linesRead(source(40));
			expect(few).toBeGreaterThan(0);
			expect(linesRead(source(400))).toBe(few);
		});
	}
});
