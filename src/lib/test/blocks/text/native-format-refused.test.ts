// @vitest-environment jsdom
// The browser's own character formatting never reaches a block's DOM: the editor writes its marks
// as bytes, so the input is refused before the browser acts on it.
// Miss-analysis: every format row pressed a chord the editor binds, so no row sent the input a
// browser sends for one it doesn't (Ctrl+U), which wrote an element the read-back then dropped.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '#lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '#lib/core/parser.js';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';
import { dispatchBeforeInput } from '../../harness/insertion-routes';

function mountParagraph() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse('hello world\n');
	const blockEdit = makeStubBlockEdit();
	const instance = mount(TextEditableBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
	});
	flushSync();
	const el = target.querySelector('.text-editable-block') as HTMLElement;
	el.focus();
	return { instance, blockEdit, el };
}

let mounted: ReturnType<typeof mountParagraph>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('the browser’s own character formatting', () => {
	it.each([
		'formatBold',
		'formatItalic',
		'formatUnderline',
		'formatStrikeThrough',
		'formatSuperscript',
		'formatSubscript'
	])('%s is refused and writes nothing', (inputType) => {
		mounted = mountParagraph();
		mounted.instance.setSelection(0, 5);
		const e = dispatchBeforeInput(mounted.el, inputType);
		expect(e.defaultPrevented).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('an input that formats no characters is left to the browser', () => {
		mounted = mountParagraph();
		mounted.instance.setSelection(0, 5);
		expect(dispatchBeforeInput(mounted.el, 'formatSetBlockTextDirection').defaultPrevented).toBe(
			false
		);
	});
});
