// @vitest-environment jsdom
//
// CodeBlock's insertLineBreak composition gate, driven through the mounted component's real
// listeners (the branch lives in the component, not an extracted helper): an IME emitting
// insertLineBreak mid-composition must not sync the CST; the same event after
// compositionend splices its newline.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CodeBlock from '$lib/components/blocks/code/CodeBlock.svelte';
import { parse } from '$lib/core/parser';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

// Async handlers finish after the dispatch returns; one macrotask drains the
// await chain (handleSharedBeforeInput) before the branch under test runs.
const settle = () => new Promise((r) => setTimeout(r));

function mountCodeBlock() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse('```\nhello\n```\n');
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

function lineBreak(): InputEvent {
	return new InputEvent('beforeinput', {
		inputType: 'insertLineBreak',
		bubbles: true,
		cancelable: true
	});
}

let mounted: ReturnType<typeof mountCodeBlock>;

beforeEach(() => {
	mounted = mountCodeBlock();
});
afterEach(async () => {
	await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('CodeBlock — insertLineBreak composition gate', () => {
	it('mid-composition insertLineBreak does not sync the CST', async () => {
		const { el, blockEdit } = mounted;
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.dispatchEvent(lineBreak());
		await settle();

		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('post-composition insertLineBreak splices its newline', async () => {
		const { el, blockEdit } = mounted;
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		vi.mocked(blockEdit.updateBlockContent).mockClear(); // drop the end-funnel commit

		el.dispatchEvent(lineBreak());
		await settle();

		expect(blockEdit.updateBlockContent).toHaveBeenCalledTimes(1);
		const [, newText] = vi.mocked(blockEdit.updateBlockContent).mock.calls[0];
		expect(newText).toContain('\n\nhello');
	});
});
