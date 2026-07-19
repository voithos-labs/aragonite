// @vitest-environment jsdom
//
// A CRLF-authored paragraph must keep its trailing `\r\n` through the keystroke
// commit funnel: the input path appended a hard `\n`, so the first keystroke
// normalized the block's trailing ending. Driven through the mounted component's
// real input listener (the commit closure lives in the component).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import type { EditorServices } from '$lib/editor-keys';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

// The render effect reads islands off the decoration engine; the stub returns none.
const noIslands = {
	islandsForPath: () => []
} as unknown as EditorServices['decorations'];

function mountText(source: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse(source);
	const blockEdit = makeStubBlockEdit();
	const instance = mount(TextEditableBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({
			blockEdit,
			doc: { doc: () => doc },
			services: { decorations: noIslands }
		})
	});
	flushSync();
	const el = target.querySelector('.text-editable-block') as HTMLElement;
	return { instance, el, blockEdit };
}

let mounted: ReturnType<typeof mountText>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
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
