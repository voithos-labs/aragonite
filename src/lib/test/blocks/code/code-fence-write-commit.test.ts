// @vitest-environment jsdom
//
// The write seam at the surface's own commit path. A native keystroke mutates the
// contenteditable and the CST hears about it through `input` — so what this layer
// proves, and neither the pure seam nor an e2e can, is that BOTH commit routes into
// that path (a keystroke and an IME composition end) reconcile the bytes before they
// reach the CST, rather than committing whatever the browser left in the DOM.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CodeBlock from '$lib/components/blocks/code/CodeBlock.svelte';
import { parse } from '$lib/core/parser';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { setCursorOffset } from '$lib/cursor/content-offsets';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

const SOURCE = '```js\nconst x = 1\n```\n';

function mountCodeBlock(source = SOURCE) {
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
	return { instance, el: target.querySelector('.code-block') as HTMLElement, blockEdit };
}

let mounted: ReturnType<typeof mountCodeBlock>;

/** What the browser leaves behind after a native edit: new text, caret in it. */
function nativeEdit(display: string, caret: number): void {
	mounted.el.textContent = display;
	mounted.el.focus();
	setCursorOffset(mounted.el, asDomTextOffset(caret));
}

function committed(): string {
	const calls = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls;
	expect(calls.length).toBe(1);
	return (calls[0][1] as string).replace(/\n$/, '');
}

beforeEach(() => {
	mounted = mountCodeBlock();
});
afterEach(async () => {
	await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('CodeBlock — the write seam on commit', () => {
	// Parser-verified: the typed run closes the block early and the tail becomes a
	// fence that swallows every following block.
	it('grows both fence runs when typing lands a closer on a body line', () => {
		nativeEdit('```js\n```\nconst x = 1\n```', 9);
		mounted.el.dispatchEvent(new Event('input', { bubbles: true }));

		expect(committed()).toBe('````js\n```\nconst x = 1\n````');
	});

	it('drops a backtick typed into the info string', () => {
		nativeEdit('```j`s\nconst x = 1\n```', 5);
		mounted.el.dispatchEvent(new Event('input', { bubbles: true }));

		expect(committed()).toBe('```js\nconst x = 1\n```');
	});

	// The IME route ends at the same funnel — compositionend calls the surface's own
	// input handler — so a composed backtick is dropped like a typed one.
	it('reconciles what an IME composition leaves behind', () => {
		mounted.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		nativeEdit('```j`s\nconst x = 1\n```', 5);
		mounted.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

		expect(committed()).toBe('```js\nconst x = 1\n```');
	});

	it('commits an ordinary body edit untouched', () => {
		nativeEdit('```js\nconst x = 2\n```', 17);
		mounted.el.dispatchEvent(new Event('input', { bubbles: true }));

		expect(committed()).toBe('```js\nconst x = 2\n```');
	});
});
