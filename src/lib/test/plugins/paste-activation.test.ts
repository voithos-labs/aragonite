// @vitest-environment jsdom
// A paste reads the plugins of the editor it lands in: a plugin's kind and its paste transform
// apply where the editor lists it, and nowhere else, though the plugin is installed.
// Miss-analysis: no test pasted a plugin kind's syntax into an editor that left it out, and the
// mounted rows that did drove the dispatcher the range-edit core replaced.
import { afterEach, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '#lib';
import { definePlugin, registerPasteTransform } from '#lib/plugin.js';
import { registerPasteSurface } from '#lib/tree-operations/paste-surfaces.js';
import { cellAt } from '../blocks/table/mount-table';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	StubDataTransfer,
	dispatchClipboardEvent,
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pasteGesture } from '../range-laws/gestures';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { tocPlugin, TOC_BLOCK } from '#packages/toc/src/index.js';
import { normalizeReplacementForBody } from '#lib/tree-operations/paste/body-write.js';
import { declaredPluginKind } from '#lib/schema/plugin-kind.js';
import { DETAILS, registerDetailsKind } from '#packages/details/src/details-kind.js';
import type { CstNode } from '#lib/core/nodes.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { type GrammarView } from '#lib/schema/block-openers.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import { testView } from '#lib/test/harness/test-view.js';

const TOC_LINE = '[[toc]]\n';
const toc = tocPlugin();

/** The grammar an editor whose `plugins` prop lists `names` parses through. */
function grammarListing(names: string[]) {
	return createEditorGrammar({ plugins: activationFor(names) });
}

beforeEach(() => {
	installPlugins([toc]);
	// A bodyWrite-declaring owner, so the escape below has a reparse to run.
	registerDetailsKind(testView());
});

// The splice's own reparse: a `bodyWrite` container
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

describe('a paste into a mounted editor reads that editor’s plugins', () => {
	const shouter = definePlugin({
		name: 'shouter',
		setup: () =>
			registerPasteTransform({
				name: 'upcase-headings',
				transform: (text) => (text.startsWith('# ') ? text.toUpperCase() : null)
			})
	});
	/** What `gatekeeper`'s paste surface was asked, in order. */
	let asked: string[] = [];
	const gatekeeper = definePlugin({
		name: 'gatekeeper',
		setup: () =>
			registerPasteSurface({
				kind: 'paragraph',
				onClipPaste: async () => (asked.push('ahead'), false),
				pastedText: (text) => (asked.push('text'), text)
			})
	});
	beforeAll(installLayoutStubs);
	beforeEach(() => {
		installPlugins([shouter, gatekeeper]);
		installClipboardEvents();
		installSystemClipboard();
		asked = [];
	});
	afterEach(destroyMountedEditors);

	/** The empty document's one line, pasted into by the key route, in an editor listing `plugins`. */
	async function pasted(plugins: readonly (typeof toc)[], text: string) {
		const editor = mountEditor<EditorTestSurface>({ source: '', plugins });
		await editor.settle();
		(editor.target.querySelector('[contenteditable="true"]') as HTMLElement).focus();
		await pasteGesture(editor, { 'text/plain': text }, 'key');
		return editor;
	}

	it.each([
		['lists it', [toc], true],
		['lists another plugin, not it', [shouter], false]
	] as const)('lands the plugin’s kind only where the editor %s', async (_, plugins, lands) => {
		const editor = await pasted([...plugins], TOC_LINE);
		const kinds = editor.instance.__test
			.getDocument()
			.children.map((block) => block.kind as string);
		expect(kinds.includes(TOC_BLOCK)).toBe(lands);
	});

	it.each([
		['lists it', [shouter], '# TITLE'],
		['lists another plugin, not it', [toc], '# title']
	] as const)('runs the plugin’s transform only where the editor %s', async (_, plugins, head) => {
		const editor = await pasted([...plugins], '# title\n');
		expect(editor.source().startsWith(head)).toBe(true);
	});

	// Miss-analysis: the transform rows pasted at the top level, and blocks pasted out of a table
	// cell run the transforms from the cell's own answer, a second call site.
	it.each([
		['lists it', [shouter], '# TITLE'],
		['lists another plugin, not it', [toc], '# title']
	] as const)(
		'runs the transform on blocks pasted out of a cell only where the editor %s',
		async (_, plugins, head) => {
			const source = '| a |\n| - |\n| b |\n';
			const editor = mountEditor<EditorTestSurface>({ source, plugins: [...plugins] });
			await editor.settle();
			const cell = cellAt(editor, 1, 0);
			cell.focus();
			window.getSelection()!.collapse(cell.firstChild, 1);
			// The event alone: the key's own turn ends before a browser sends it.
			const clip = new StubDataTransfer({ 'text/plain': '# title\n\npara' });
			dispatchClipboardEvent(cell, 'paste', clip);
			await editor.settle();
			expect(editor.source()).toContain(`${head}\n`);
		}
	);

	// Miss-analysis: the row that asked a plugin's paste surface only where its plugin is listed
	// drove the dispatcher the range-edit core replaced, and no live row registered one.
	it.each([
		['lists it', [gatekeeper], ['ahead', 'text']],
		['lists another plugin, not it', [toc], []]
	] as const)(
		'asks a plugin’s paste surface only where the editor %s',
		async (_, plugins, said) => {
			await pasted([...plugins], 'word');
			expect(asked).toEqual(said);
		}
	);
});
