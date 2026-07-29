// @vitest-environment jsdom
//
// The block-command seam folds a live reveal before it mutates, and must not act
// until that fold's WRITE has landed. A commit that changes the block's kind takes
// the structural path, whose completion is a promise, not a fixed number of ticks —
// waiting a tick instead leaves the command spliced against a block the fold's own
// commit is still replacing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';
import { installMathInline } from './math-widget-fixture';

installMathInline();

// A whole-block `$x$` paragraph: the reveal swaps the one widget for its editable
// source, so an edit typed at source offset 0 reaches the block's leading bytes —
// `# ` there makes the fold's own commit a paragraph→heading flip.
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

// Drains the microtask queue the fold's settle chain runs on, so the assertions
// read a quiesced state instead of counting ticks.
const flush = () => new Promise((resolve) => setTimeout(resolve));

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
		await flush();

		// The reveal's swapped-in source node, edited the way typing at source offset
		// 0 edits it. `input` is suppressed while revealed, so this stays ephemeral
		// DOM until the fold reads it back.
		const source = Array.from(el.childNodes).find(
			(child): child is Text => child.nodeType === Node.TEXT_NODE
		);
		expect(source?.textContent).toBe('$x$');
		source!.textContent = '# $x$';

		expect(instance.runCommand('block.split')).toBe(true);
		await flush();

		expect(mounted.writeLanded()).toBe(false);
		expect(blockEdit.splitBlock).not.toHaveBeenCalled();

		mounted.releaseWrite();
		await flush();

		expect(mounted.writeLanded()).toBe(true);
		expect(blockEdit.splitBlock).toHaveBeenCalledTimes(1);
	});
});
