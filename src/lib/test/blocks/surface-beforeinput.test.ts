// @vitest-environment jsdom
// The shared `beforeinput` step every editable element runs: the browser's own Undo and Redo, and
// a character typed over a range across blocks. A block's own handler gets the event synchronously.
// Miss-analysis: each block made the shared call itself, so the leaf that never made it went
// untested, and every block awaited it, which only a check right after the dispatch can see.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { unmount } from 'svelte';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '../harness/mount-editor.svelte';
import { pressKey, settleEditor } from '../harness/settle';
import { mountBlock } from '../harness/mount-block';
import { cellAt, installTableLayoutStubs } from './table/mount-table';
import { leafDocument, mountRevealLeaf, registerRevealLeafKind } from './fixtures/reveal-leaf';
import PlainOneLineLeafBlock from './fixtures/PlainOneLineLeafBlock.svelte';

const beforeInput = (inputType: string) =>
	new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });

function paint(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	frag.appendChild(document.createTextNode(text));
	return frag;
}

beforeAll(() => {
	installLayoutStubs();
	return installTableLayoutStubs();
});

const unmounts: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const done of unmounts.splice(0)) await done();
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

describe("a plugin leaf's beforeinput runs the shared step", () => {
	it("the browser's Undo in a plain leaf is the editor's", async () => {
		const kind = registerRevealLeafKind('shared-step-plain');
		const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
		const plain = mountBlock(PlainOneLineLeafBlock, {
			doc: leafDocument(kind, '@@ one\n'),
			overrides: { history }
		});
		unmounts.push(plain.dispose);
		const el = plain.target.querySelector<HTMLElement>('.plain-one-line-source')!;
		el.focus();

		const undo = beforeInput('historyUndo');
		el.dispatchEvent(undo);
		await settleEditor();

		expect(undo.defaultPrevented).toBe(true);
		expect(history.requestUndo).toHaveBeenCalledTimes(1);
	});

	it("the browser's Undo inside a shown painted source steps through the source's own edits", async () => {
		const kind = registerRevealLeafKind('shared-step-painted');
		const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
		const mounted = mountRevealLeaf(leafDocument(kind, '@@ one\n'), {
			props: { paint },
			overrides: { history }
		});
		unmounts.push(() => unmount(mounted.instance));
		const el = await mounted.revealAtEnd();
		await pressKey(el, { key: 'Enter' });
		expect(el.textContent).toBe('@@ one\n');

		const undo = beforeInput('historyUndo');
		el.dispatchEvent(undo);
		await settleEditor();

		expect(undo.defaultPrevented).toBe(true);
		expect(el.textContent).toBe('@@ one');
		expect(history.requestUndo).not.toHaveBeenCalled();
	});
});

describe('a block handling a beforeinput cancels it before the dispatch returns', () => {
	const firstBlock = (editor: MountedEditor) => surfaceAt(editor, [0]);
	it.each([
		['the text block', 'para\n', firstBlock, 1],
		['a table cell', '| a |\n| - |\n| b |\n', (editor: MountedEditor) => cellAt(editor, 1, 0), 1],
		['the code block', '```\ncode\n```\n', firstBlock, 5]
	] as const)('%s, a line break', (_, source, surface, caret) => {
		const editor = mountEditor({ source });
		const el = surface(editor);
		placeCaret(el, caret);

		const cancelled = !el.dispatchEvent(beforeInput('insertLineBreak'));

		expect(cancelled).toBe(true);
	});
});
