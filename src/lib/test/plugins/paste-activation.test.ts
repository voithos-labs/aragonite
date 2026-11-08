// @vitest-environment jsdom
// Miss-analysis: no test pasted a plugin kind's syntax into an editor that left it out (GH #267).
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { installPlugins } from '#lib';
import { parse } from '#lib/core/parser.js';
import { tocPlugin, TOC_BLOCK } from '#packages/toc/src/index.js';
import { normalizeReplacementForBody } from '#lib/tree-operations/paste/body-write.js';
import { declaredPluginKind } from '#lib/schema/plugin-kind.js';
import { DETAILS, registerDetailsKind } from '#packages/details/src/details-kind.js';
import type { CstNode } from '#lib/core/nodes.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { type GrammarView } from '#lib/schema/block-openers.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import {
	makeStubBlockEdit,
	runPasteDispatch,
	makePasteCommit
} from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { testView } from '#lib/test/harness/test-view.js';

const TOC_LINE = '[[toc]]\n';

/** The grammar an editor whose `plugins` prop lists `names` parses through. */
function grammarListing(names: string[]) {
	return createEditorGrammar({ plugins: activationFor(names) });
}

beforeEach(() => {
	installPlugins([tocPlugin()]);
	// A bodyWrite-declaring owner, so the escape below has a reparse to run.
	registerDetailsKind(testView());
});

async function pasteInto(grammar: ReturnType<typeof grammarListing>) {
	const h = makePasteCommit(parse('target\n').children);
	const blockEdit = makeStubBlockEdit();
	await runPasteDispatch(
		h,
		{ pastedText: TOC_LINE, targetPath: [0], offset: 'target'.length },
		{ blockEdit, reading: fixtureReading({ grammar }) }
	);
	return { doc: h.doc, blockEdit };
}

describe('a paste parses through the instance grammar, not the global one', () => {
	it('lands the plugin kind for an editor that lists the plugin', async () => {
		const { doc } = await pasteInto(grammarListing(['toc']));
		expect(doc.children.map((c) => c.kind)).toContain(TOC_BLOCK);
	});

	// The unlisted opener is gone, so the clipboard is one paragraph: inline, with the marker
	// bytes arriving as prose rather than creating a kind this editor has no component for.
	it('falls back to prose for an editor that does not', async () => {
		const { doc, blockEdit } = await pasteInto(grammarListing([]));
		expect(doc.children.map((c) => c.kind)).not.toContain(TOC_BLOCK);
		const write = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(write[1]).toContain('target[[toc]]');
	});
});

// The splice's own reparse, one layer under the dispatch above: a `bodyWrite` container
// escapes the pasted bytes and re-reads them, so it has to use the grammar the clipboard used.
describe('the bodyWrite escape reparse reads the instance grammar', () => {
	const pasted = (): CstNode[] => [
		{ kind: 'paragraph', leadingTrivia: '', raw: TOC_LINE + '</details>\n' } as CstNode
	];
	const landedKinds = (grammar: GrammarView) =>
		normalizeReplacementForBody(
			{ kind: declaredPluginKind(DETAILS), leadingTrivia: '', raw: '' } as CstNode,
			pasted(),
			'\n',
			grammar
		).replacement.map((n) => n.kind);

	it('the global grammar creates the plugin kind', () => {
		expect(landedKinds(defaultGrammarView)).toContain(TOC_BLOCK);
	});

	it('the grammar of an editor without the plugin keeps it prose', () => {
		expect(landedKinds(grammarListing([]))).not.toContain(TOC_BLOCK);
	});
});
