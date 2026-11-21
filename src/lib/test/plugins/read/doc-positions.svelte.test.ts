// @vitest-environment jsdom
// Every block a `Doc` walks sits where the range layout puts its node, in a mounted editor and in
// `grammar(plugins).parse`, and the two read one text alike.
// Miss-analysis: the block positions were checked at a handful of hand-picked bytes, never over
// every block of the corpus, nor outside an editor.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentView } from '#lib/core/node-views.js';
import { parse } from '#lib/core/parser.js';
import { walkBlocks } from '#lib/core/paths.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { grammar } from '#lib/components/editor-root/headless-grammar.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { container } from '#lib/components/block-makers/container.js';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import type { PluginsProp } from '#lib/schema/plugin-install.js';
import type { Doc } from '#lib/schema/doc-view.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { createEditorActivation } from '#lib/schema/plugin-activation.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { FLUSH_JOIN_DOCUMENTS, SMALL_DOCUMENTS, SYNTAX_PLUGINS } from '../../behavior/corpus';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const CORPUS = Object.entries({ ...SMALL_DOCUMENTS, ...FLUSH_JOIN_DOCUMENTS });

async function mounted(source: string, plugins: PluginsProp) {
	let editor: Editor | undefined;
	const reader = definePluginUnit({
		name: 'unit-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void (editor = e) })
	});
	const m = mountEditor<EditorTestSurface>({ source, plugins: [reader, ...plugins] });
	await m.settle();
	return { editor: editor!, tree: m.instance.__test.getDocument() as DocumentView };
}

/** Where `doc` puts each block it walks, title rows included, against the layout of `tree`. */
function misplaced(doc: Doc, tree: DocumentView): string[] {
	const layout = documentLayout(measured(tree));
	const paths: number[][] = [];
	walkBlocks(tree, (_node, path) => void paths.push(path));
	const walked = [...doc.walk()];
	const out: string[] = [];
	if (walked.length !== paths.length) out.push(`walked ${walked.length} of ${paths.length}`);
	paths.forEach((path, i) => {
		const block = walked[i] ?? null;
		const laid = layout.block(path);
		if (!block || laid?.from !== block.from || laid.to !== block.to)
			out.push(`${path}: ${block?.from}-${block?.to}, laid ${laid?.from}-${laid?.to}`);
	});
	return out;
}

describe("every block's from and to are the layout's", () => {
	it.each(CORPUS)('mounted: %s', async (_id, source) => {
		const { editor, tree } = await mounted(source, SYNTAX_PLUGINS);
		expect(misplaced(editor.doc, tree)).toEqual([]);
	});

	it.each(CORPUS)('parsed: %s', (_id, source) => {
		const plain = createEditorGrammar({ plugins: createEditorActivation([]) });
		const tree = parse(source, { grammar: plain }) as DocumentView;
		expect(misplaced(grammar([]).parse(source), tree)).toEqual([]);
	});
});

const marks = definePluginUnit({
	name: 'marks',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'level',
				label: 'Level',
				match: /^%%(?<n>\d) (?<text>.*)$/,
				data: (m) => Number(m.groups!.n),
				write: (n, text) => `%%${n} ${text}`,
				sample: '%%1 hi',
				insert: { none: 'a test block type' }
			}),
			container({
				name: 'aside',
				label: 'Aside',
				sample: '%> x',
				insert: { none: 'a test block type' },
				lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true }
			})
		]
	})
});

const PLUGGED = 'intro *em*\n\n%%2 level two\n\n%> aside one\n%> - item\n\n- a\n  - b\n';

describe('grammar(plugins).parse', () => {
	// Miss-analysis: a new home; no read of the document stood outside a mounted editor.
	it('reads text as a mounted editor running those plugins does', async () => {
		const read = (doc: Doc) =>
			[...doc.walk()].map((b) => [b.type.name, b.text, b.from, b.to, b.index, b.data]);
		const { editor } = await mounted(PLUGGED, [marks]);
		const parsed = grammar([marks]).parse(PLUGGED);
		expect(read(parsed)).toEqual(read(editor.doc));
		expect(read(parsed).map(([type]) => type)).toContain('marks/aside');
		expect([parsed.text, parsed.eol, parsed.current]).toEqual([PLUGGED, '\n', true]);
		expect(parsed.blockAt(PLUGGED.indexOf('two'))!.data).toBe(2);
	});
});
