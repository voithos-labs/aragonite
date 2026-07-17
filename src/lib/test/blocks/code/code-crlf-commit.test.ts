// @vitest-environment jsdom
//
// A CRLF-authored fenced code block must keep its trailing `\r\n` through the
// keystroke commit funnel: the input path appended a hard `\n`, so the first
// keystroke normalized the block's trailing ending. Driven through the mounted
// component's real input listener (the commit closure lives in the component).
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CodeBlock from '$lib/components/blocks/code/CodeBlock.svelte';
import { parse } from '$lib/core/parser';
import { vi } from 'vitest';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

function mountCode(source: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse(source);
	const blockEdit = makeStubBlockEdit();
	const instance = mount(CodeBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
	});
	flushSync();
	const el = target.querySelector('.code-block') as HTMLElement;
	return { instance, el, blockEdit };
}

let mounted: ReturnType<typeof mountCode>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('CodeBlock keystroke commit preserves the trailing line ending', () => {
	it('a typed edit on a CRLF block commits raw ending in `\\r\\n`', () => {
		mounted = mountCode('```\r\ncode\r\n```\r\n');
		const { el, blockEdit } = mounted;
		el.textContent = 'edited';
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));

		expect(blockEdit.updateBlockContent).toHaveBeenCalledTimes(1);
		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw.endsWith('\r\n')).toBe(true);
	});

	it('a typed edit on an LF block still commits raw ending in `\\n` (unchanged)', () => {
		mounted = mountCode('```\ncode\n```\n');
		const { el, blockEdit } = mounted;
		el.textContent = 'edited';
		el.dispatchEvent(new InputEvent('input', { bubbles: true }));

		const [, newRaw] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newRaw.endsWith('\r\n')).toBe(false);
		expect(newRaw.endsWith('\n')).toBe(true);
	});
});
