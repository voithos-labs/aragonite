// @vitest-environment jsdom
//
// The block-edge arms in a mode that paints no marker: the caret's reachable bounds are the
// kind's CONTENT range, and a kind declaring `contentStartBackspace: 'demote-first'` gives up its
// own structural bytes before the merge cascade sees the press.
// Miss-analysis: the arms were pinned only through their byte effects at raw 0, which every mode
// agrees on, so nothing could observe the bound moving — the one thing live changes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import type { PresentationMode } from '$lib/presentation-mode';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

/** One block under a presentation root, focused, with the caret seated by the block's own door. */
function mountBlock(source: string, mode: PresentationMode, caret: number) {
	const root = document.createElement('div');
	if (mode !== 'source') root.setAttribute('data-presentation', mode);
	document.body.appendChild(root);
	const doc = parse(source);
	const blockEdit = makeStubBlockEdit();

	const instance = mount(TextEditableBlock, {
		target: root,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({
			blockEdit,
			doc: { doc: () => doc },
			policies: { presentationMode: () => mode }
		})
	});
	flushSync();

	(root.querySelector('.text-editable-block') as HTMLElement).focus();
	instance.setSelection(caret, caret);
	return { instance, blockEdit };
}

let mounted: ReturnType<typeof mountBlock>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

describe('Backspace at content start in live mode', () => {
	it('demotes an ATX heading in one commit instead of merging', () => {
		mounted = mountBlock('## Title\n', 'live', 3);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Title\n', 3, 0);
		expect(mounted.blockEdit.mergeWithPrevious).not.toHaveBeenCalled();
	});

	// Setext carries its structure as a SUFFIX, so its content start is raw 0 and the same
	// declaration has to reach the press from the other end.
	it('drops a setext heading’s underline', () => {
		mounted = mountBlock('Title\n===\n', 'live', 0);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, 'Title\n', 0, 0);
		expect(mounted.blockEdit.mergeWithPrevious).not.toHaveBeenCalled();
	});

	// Raw 0 is behind the unpainted prefix: no caret reaches it in live, and the arm answers for
	// the offsets that exist rather than for the one the other modes call the start.
	it('declines at raw 0 of a heading, which is not a reachable caret', () => {
		mounted = mountBlock('## Title\n', 'live', 0);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(false);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
		expect(mounted.blockEdit.mergeWithPrevious).not.toHaveBeenCalled();
	});

	it('merges a kind that declares no demote, at its own content start', () => {
		mounted = mountBlock('Title\n', 'live', 0);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.mergeWithPrevious).toHaveBeenCalledWith(0);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});
});

// Source and the preview rungs paint the prefix, so the bytes beside the caret are the user's to
// delete and raw 0 is the block's start exactly as before.
describe('the same press outside a marker-hiding mode', () => {
	it.each<PresentationMode>(['source', 'preview-inline'])('merges at raw 0 in %s', (mode) => {
		mounted = mountBlock('## Title\n', mode, 0);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(true);
		expect(mounted.blockEdit.mergeWithPrevious).toHaveBeenCalledWith(0);
		expect(mounted.blockEdit.updateBlockContent).not.toHaveBeenCalled();
	});

	it('does not fire at the content start in source', () => {
		mounted = mountBlock('## Title\n', 'source', 3);

		expect(mounted.instance.runCommand('block.mergePrev')).toBe(false);
		expect(vi.mocked(mounted.blockEdit.updateBlockContent)).not.toHaveBeenCalled();
	});
});
