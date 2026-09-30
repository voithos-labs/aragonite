// @vitest-environment jsdom
// Typing into a block keeps the block's own line ending, so a document saved without a final
// line break keeps none, whichever editable element the last block is.
// Miss-analysis: GH #616, the typing fixtures all ended in a line break, and the one that did not
// pinned the document's ending being added.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '../harness/mount-editor.svelte';
import { settleEditor } from '../harness/settle';
import { mountBlock } from '../harness/mount-block';
import { leafDocument, registerRevealLeafKind } from './fixtures/reveal-leaf';
import PlainOneLineLeafBlock from './fixtures/PlainOneLineLeafBlock.svelte';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

function typeInto(el: HTMLElement, text: string): void {
	el.textContent = text;
	placeCaret(el, text.length);
	el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

describe('a keystroke on the unterminated last block', () => {
	it.each([
		['a paragraph', 'a\n\nlast', 'lastZ', 'a\n\nlastZ'],
		['a heading', 'a\n\n# last', '# lastZ', 'a\n\n# lastZ'],
		['a CRLF paragraph', 'a\r\n\r\nlast', 'lastZ', 'a\r\n\r\nlastZ'],
		['a code block', 'a\n\n```\nx\n```', '```\nxZ\n```', 'a\n\n```\nxZ\n```']
	])('in %s keeps it unterminated', async (_, source, typed, expected) => {
		const editor = mountEditor({ source });
		typeInto(surfaceAt(editor, [1]), typed);
		await editor.settle();
		expect(editor.source()).toBe(expected);
	});

	it('in a plugin leaf keeps it unterminated', async () => {
		const kind = registerRevealLeafKind('unterminated-leaf');
		const leaf = mountBlock(PlainOneLineLeafBlock, { doc: leafDocument(kind, '@@ one') });
		const el = leaf.target.querySelector<HTMLElement>('.plain-one-line-source')!;

		typeInto(el, '@@ oneZ');
		await settleEditor();

		expect(leaf.blockEdit.updateBlockContent.mock.calls.map((call) => call[1])).toEqual([
			'@@ oneZ'
		]);
		await leaf.dispose();
	});
});
