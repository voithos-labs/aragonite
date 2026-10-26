// An edit to a fenced block's opener keeps every byte below it, on every route into a kind's
// write rule: the stranded closing line stays, read as a reload reads it.
// Miss-analysis (GH #768): the fence and `$$` rules each pinned their drop as intended, and no
// check compared what a rule kept against what the write left alone.
import { describe, it, expect, beforeEach } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { parse } from '#lib/core/parser.js';
import type { Document } from '#lib/core/nodes.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite, updateNodeContent } from '#lib/tree-operations/content-write.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { registerMathBlock } from '#lib/plugins/latex/latex-kind.js';
import { registerMermaidKind } from '#lib/plugins/mermaid/mermaid-kind.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { deleteRange } from '#lib/test/harness/range-delete.js';
import { makeSearchReplace, scanCompiled } from '#lib/test/harness/search-replace.js';
import { testView } from '#lib/test/support/test-view.js';

beforeEach(() => {
	registerMathBlock(testView());
	registerMermaidKind(testView());
});

/** Block 1 of each fixture loses its first `cut` bytes; `query` is a match that holds them. */
const KINDS: Array<{ kind: string; raw: string; cut: number; query: string; skip?: string }> = [
	{ kind: 'fencedCode', raw: '```js\ncode\n```\n', cut: 1, query: '```js' },
	{ kind: 'mathFence', raw: '```math\nx\n```\n', cut: 1, query: '```math' },
	// A replace into a diagram applies only when the kind survives it.
	{ kind: 'mermaid', raw: '```mermaid\nA\n```\n', cut: 1, query: '```mermaid', skip: 'a replace' },
	{ kind: 'mathBlock', raw: '$$\nx\n$$\n', cut: 1, query: '$$\nx' }
];

const sourceOf = (raw: string) => `para\n\n${raw}\nafter\n`;

type Route = (source: string, fixture: (typeof KINDS)[number]) => Promise<Document> | Document;

const ROUTES: Array<[string, Route, (raw: string, cut: number) => string]> = [
	[
		'a typed key',
		(source, { raw, cut }) => {
			const { deps } = makeEditorActionsDeps(source);
			const typing = createUndoController(deps);
			const write = legalizeWrite(deps.doc, 1, raw.slice(cut), 'authored');
			typing.typeLeaf(docPathFrom([1]), write, 0);
			return deps.doc;
		},
		(raw, cut) => sourceOf(raw.slice(cut))
	],
	[
		'a write no commit follows',
		(source, { raw, cut }) => {
			const doc = parse(source);
			updateNodeContent(doc, 1, raw.slice(cut), defaultGrammarView, createSharingState());
			return doc;
		},
		(raw, cut) => sourceOf(raw.slice(cut))
	],
	[
		'a replace',
		async (source, { query, cut }) => {
			const { deps, sr } = makeSearchReplace(source);
			await sr.replaceAll(scanCompiled(deps.doc, query, { caseSensitive: true }), query.slice(cut));
			return deps.doc;
		},
		(raw, cut) => sourceOf(raw.slice(cut))
	],
	[
		'a range delete from the block above',
		(source, { cut }) => {
			const doc = parse(source);
			deleteRange(doc, { path: [0], offset: 2 }, { path: [1], offset: cut });
			return doc;
		},
		(raw, cut) => `pa${raw.slice(cut)}\nafter\n`
	]
];

describe('a write rule keeps the bytes below an edited first line', () => {
	for (const fixture of KINDS) {
		for (const [route, run, expected] of ROUTES) {
			if (route === fixture.skip) continue;
			it(`${fixture.kind}, ${route}`, async () => {
				const doc = await run(sourceOf(fixture.raw), fixture);

				expect(serialize(doc)).toBe(expected(fixture.raw, fixture.cut));
				expectParseConverged(doc);
			});
		}
	}
});
