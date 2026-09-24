// @vitest-environment jsdom
//
// Miss-analysis: no plugin test ran under an editor whose plugins prop left something out, so a
// plugin's inline read agreed with the render in every case the suite drew.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parse, type DocumentView } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { installPlugins } from '$lib/schema/plugin-install';
import { activationFor } from '$lib/schema/plugin-activation';
import { createEditorPluginContexts } from '$lib/schema/plugin-editor-context';
import { latexPlugin } from '$lib/plugins/latex';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import {
	assignFootnoteNumbers,
	footnoteNumbersFor
} from '$lib/plugins/footnotes/footnote-numbering';
import { tocPlugin } from '$lib/plugins/toc';
import { collectHeadings } from '$lib/plugins/toc/heading-outline';
import type { EditorContext } from '$lib/plugin';
import { inlineReaderFor } from '$lib/core/inline';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';
import { grammarListing } from './grammar-listing';

beforeAll(() => {
	resetPluginPlatformForTests();
	installPlugins([
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		footnotesPlugin(),
		tocPlugin()
	]);
});
afterAll(resetPluginPlatformForTests);
afterEach(disablePerfInstruments);

/** One editor listing `names`, its document parsed in its grammar, and one plugin's context. */
function editorListing(names: string[], source: string, plugin: string) {
	const grammar = grammarListing(names);
	const doc = parse(source, { grammar }) as DocumentView;
	const contexts = createEditorPluginContexts({
		editorId: 'ed',
		getDoc: () => doc,
		events: { on: () => () => {} } as never,
		optionsFor: () => undefined,
		decorations: {} as never,
		rects: {} as never,
		inlineMenus: {} as never,
		getDocumentGeneration: () => 0,
		getPresentationMode: () => 'source',
		getTheme: () => 'dark',
		activation: activationFor(names),
		computeInlineContent: inlineReaderFor(grammar),
		insertMarkdown: async () => false,
		runCommand: () => false
	});
	return { doc, editor: contexts.get(plugin) as EditorContext };
}

describe('footnote numbering reads its editor’s inline syntax', () => {
	const SOURCE = 'a $[^x]$ b\n\n[^x]: note\n';

	it('numbers a reference inside dollars the editor draws as text', () => {
		const { doc, editor } = editorListing(['footnotes'], SOURCE, 'footnotes');
		expect(assignFootnoteNumbers(doc, editor.computeInlineContent).get('x')).toBe(1);
	});

	it('skips it where the editor reads the dollars as math', () => {
		const { doc, editor } = editorListing(['footnotes', 'latex'], SOURCE, 'footnotes');
		expect(assignFootnoteNumbers(doc, editor.computeInlineContent).has('x')).toBe(false);
	});
});

describe('toc labels read their editor’s inline syntax', () => {
	const SOURCE = '# Title $*x*$\n\n[[toc]]\n';
	const labelIn = (names: string[]) => {
		const { doc, editor } = editorListing(names, SOURCE, 'toc');
		return collectHeadings(doc, 6, editor.computeInlineContent)[0].label;
	};

	it('drops the emphasis markers where latex is left out', () => {
		expect(labelIn(['toc'])).toBe('Title $x$');
	});

	it('keeps the math source where latex is listed', () => {
		expect(labelIn(['toc', 'latex'])).toBe('Title $*x*$');
	});
});

describe('the numbering cache keeps each editor’s answer apart', () => {
	it('answers two editors over one document with their own numbering', () => {
		const doc = parse('a $[^x]$ b\n', { grammar: grammarListing(['footnotes']) }) as DocumentView;
		const withoutLatex = inlineReaderFor(grammarListing(['footnotes']));
		const withLatex = inlineReaderFor(grammarListing(['footnotes', 'latex']));
		expect(assignFootnoteNumbers(doc, withoutLatex).has('x')).toBe(true);
		expect(assignFootnoteNumbers(doc, withLatex).has('x')).toBe(false);
	});

	// Each block's widget pool asks for its own reader, so the cache hits only if one grammar
	// always hands back the same function.
	it('shares one numbering across the readers one grammar hands out', () => {
		const grammar = grammarListing(['footnotes']);
		const blocks = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} [^r${i}].`);
		const doc = parse(blocks.join('\n\n') + '\n', { grammar });
		footnoteNumbersFor(doc, 1, inlineReaderFor(grammar));

		resetPerfInstruments();
		enablePerfInstruments();
		expect(footnoteNumbersFor(doc, 1, inlineReaderFor(grammar)).get('r9')).toBe(10);
		doc.children[3].raw = 'Paragraph 3 [^r3] [^extra].';
		expect(footnoteNumbersFor(doc, 2, inlineReaderFor(grammar)).get('extra')).toBe(5);
		expect(perfSnapshot().inlineComputeCount).toBe(1);
	});
});
