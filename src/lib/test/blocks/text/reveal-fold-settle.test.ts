// @vitest-environment jsdom
//
// A block command hides a shown source before it writes, and must not act until that write has
// landed. A commit that changes the block's kind takes the structural path, whose completion is
// a promise rather than a fixed number of ticks, so waiting one tick instead would leave the
// command splicing against a block that commit is still replacing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';
import { installMathInline } from './math-widget-fixture';
import { settleEditor } from '$lib/test/harness/settle';

installMathInline();

// A whole-block `$x$` paragraph: showing the source swaps the widget for editable text, so `# `
// typed at offset 0 makes that commit turn the paragraph into a heading.
function mountMathParagraph() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse('$x$\n');
	const blockEdit = makeStubBlockEdit();

	let releaseWrite!: () => void;
	const writeGate = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	let writeLanded = false;
	vi.mocked(blockEdit.updateBlockContent).mockImplementation(async () => {
		await writeGate;
		writeLanded = true;
	});

	const instance = mount(TextEditableBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
	});
	flushSync();

	return {
		instance,
		blockEdit,
		releaseWrite,
		writeLanded: () => writeLanded,
		el: target.querySelector('.text-editable-block') as HTMLElement
	};
}

let mounted: ReturnType<typeof mountMathParagraph>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('a block command waits for the reveal fold it triggered', () => {
	it('holds the command until the fold’s kind-changing write settles', async () => {
		mounted = mountMathParagraph();
		const { instance, el, blockEdit } = mounted;

		expect(instance.enterEdgeWidget('start')).toBe(true);
		await settleEditor();

		// The source text node swapped in. `input` is suppressed while it shows, so this lives
		// only in the DOM until the commit reads it back.
		const source = Array.from(el.childNodes).find(
			(child): child is Text => child.nodeType === Node.TEXT_NODE
		);
		expect(source?.textContent).toBe('$x$');
		source!.textContent = '# $x$';

		expect(instance.runCommand('block.split')).toBe(true);
		await settleEditor();

		expect(mounted.writeLanded()).toBe(false);
		expect(blockEdit.splitBlock).not.toHaveBeenCalled();

		mounted.releaseWrite();
		await settleEditor();

		expect(mounted.writeLanded()).toBe(true);
		expect(blockEdit.splitBlock).toHaveBeenCalledTimes(1);
	});
});
