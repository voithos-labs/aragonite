// @vitest-environment jsdom
//
// A paragraph written with CRLF must keep its trailing `\r\n` through the keystroke commit:
// appending a hard `\n` there would make the first keystroke rewrite the block's line ending.
// Driven through the mounted component's real input listener, since the commit lives there.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { unmount } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import type { EditorServices } from '$lib/editor-keys';
import { mountBlock } from '../../harness/mount-block';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '../../harness/mount-editor.svelte';

// The render effect reads decorations off `decorationEngine`; the stub returns none.
const noIslands = {
	islandsForPath: () => []
} as unknown as EditorServices['decorations'];

function mountText(source: string) {
	const { instance, target, blockEdit } = mountBlock(TextEditableBlock, {
		source,
		overrides: { services: { decorations: noIslands } }
	});
	const el = target.querySelector('.text-editable-block') as HTMLElement;
	return { instance, el, blockEdit };
}

let mounted: ReturnType<typeof mountText> | undefined;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('TextEditableBlock keystroke commit preserves the trailing line ending', () => {
	it('a typed edit on a CRLF paragraph commits raw ending in `\\r\\n`', () => {
		mounted = mountText('hello\r\n');
		const { el, blockEdit } = mounted;
		el.textContent = 'hello world';
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));

		expect(blockEdit.updateBlockContent).toHaveBeenCalledTimes(1);
		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw.endsWith('\r\n')).toBe(true);
	});

	it('a typed edit on an LF paragraph still commits raw ending in `\\n` (unchanged)', () => {
		mounted = mountText('hello\n');
		const { el, blockEdit } = mounted;
		el.textContent = 'hello world';
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));

		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw.endsWith('\r\n')).toBe(false);
		expect(newRaw.endsWith('\n')).toBe(true);
	});
});

// Miss-analysis: every fixture above ends in a line ending, so no case reached the last line of a
// document without one, where the block has no ending of its own to reattach (#458).
describe('a keystroke on the unterminated last line of a CRLF document', () => {
	beforeAll(installLayoutStubs);
	afterEach(destroyMountedEditors);

	it('terminates the line with the document ending, CRLF', async () => {
		const editor = mountEditor({ source: 'abc\r\n\r\nlast' });
		const el = surfaceAt(editor, [1]);
		el.textContent = 'lastZ';
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await editor.settle();
		expect(editor.source()).toBe('abc\r\n\r\nlastZ\r\n');
	});
});
