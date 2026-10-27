// A write that moves where a construct closes re-pairs every opener and closer below it as a
// reload does, however many blocks the pairing crosses, and stops where nothing below pairs.
// Miss-analysis (GH #768): the convergence rows had one block below the edited fence, so no
// re-pairing ever reached a second fence further down.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { registerMathBlock } from '#lib/plugins/latex/latex-kind.js';
import { registerMermaidKind } from '#lib/plugins/mermaid/mermaid-kind.js';
import { testView } from '#lib/test/harness/test-view.js';
import { typingOver } from '#lib/test/harness/typing.js';
import { makeReorderHarness } from '#lib/test/editor-actions/reorder-harness.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

beforeEach(() => {
	registerMathBlock(testView());
	registerMermaidKind(testView());
});
afterEach(() => disablePerfInstruments());

/** Each kind's block, a block further down whose opener its broken closer pairs with, and one
 *  whose bare opener does. */
const KINDS: Array<{ kind: string; raw: string; later: string; bare: string }> = [
	{
		kind: 'fencedCode',
		raw: '```js\ncode\n```\n',
		later: '```py\nx\n```\n',
		bare: '```\nx\n```\n'
	},
	{
		kind: 'fencedCode',
		raw: '~~~js\ncode\n~~~\n',
		later: '~~~py\nx\n~~~\n',
		bare: '~~~\nx\n~~~\n'
	},
	{ kind: 'mathFence', raw: '```math\nx\n```\n', later: '```py\nx\n```\n', bare: '```\nx\n```\n' },
	{ kind: 'mermaid', raw: '```mermaid\nA\n```\n', later: '```py\nx\n```\n', bare: '```\nx\n```\n' },
	{ kind: 'mathBlock', raw: '$$\nx\n$$\n', later: '$$\ny\n$$\n', bare: '$$\ny\n$$\n' },
	{ kind: 'htmlBlock', raw: '<!--\nx\n-->\n', later: '<!--\ny\n-->\n', bare: '<!--\ny\n-->\n' }
];

const TAIL = Array.from({ length: 500 }, (_, i) => `paragraph ${i}\n`).join('\n');

describe('a write that moves a closer re-pairs the blocks below as a reload does', () => {
	for (const { kind, raw, later, bare } of KINDS) {
		const name = `${kind} (${raw.slice(0, 3)})`;

		// The stranded closer pairs with the bare opener, whose own closer pairs with the next one.
		it(`${name}: a broken opener typed back restores the document`, () => {
			const source = `para\n\n${raw}\ntext\n\n${bare}\nmid\n\n${later}\nafter\n`;
			const { doc, type } = typingOver(source);

			expect(type(1, raw.slice(1))).toBe(source.replace(raw, () => raw.slice(1)));
			expect(type(1, raw[0] + doc.children[1].raw)).toBe(source);
			expect(doc.children[1].kind).toBe(kind);
		});

		it(`${name}: a broken opener alone re-pairs a bare opener further down`, () => {
			const source = `para\n\n${raw}\ntext\n\n${bare}\nmore\n`;
			const { type } = typingOver(source);

			expect(type(1, raw.slice(1))).toBe(source.replace(raw, () => raw.slice(1)));
		});

		it(`${name}: with nothing below to pair, the re-read reads the tail once`, () => {
			const source = `para\n\n${raw}\n${TAIL}`;
			const { type } = typingOver(source);
			enablePerfInstruments();
			resetPerfInstruments();

			expect(type(1, raw.slice(1))).toBe(source.replace(raw, () => raw.slice(1)));
			// One pass over the tail, plus the dev checks' own reads; swallowing it block by block reads it
			// once per block.
			expect(perfSnapshot().parseBytes).toBeLessThan(8 * source.length);
		});
	}

	it('a move that puts an unclosed fence above a bare-fenced block re-pairs them', async () => {
		const source = 'a\n\n```\nx\n```\n\nb\n\n```js\nopen\n';
		const { doc, reorder } = makeReorderHarness(source);

		expect(await reorder.moveReorderUnit([3], 0)).toBe(true);
		expectParseConverged(doc);
		expect(serialize(doc)).toContain('```js\nopen\n');
	});
});
