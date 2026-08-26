// @vitest-environment jsdom
//
// `link.openCard` paints pressed from the construct the card would EDIT, not from the mark table
// every other toolbar id reads — and a range must lie inside that construct, since the card edits
// one link.
// Miss-analysis: the pressed read was a mark-row lookup that returned before any read, and no test
// at either surface ever asked a NON-mark command what it painted, so the whole id class with no
// mark row was unasserted.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import type { PresentationMode } from '$lib/presentation-mode';
import type { EditorServices } from '$lib/editor-keys';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

const noIslands = { islandsForPath: () => [] } as unknown as EditorServices['decorations'];

/** `Visit [example](https://x.com) now`: the link spans [6, 30), ` now` runs to 34. */
const LINKED = 'Visit [example](https://x.com) now\n';

function mountText(source: string, mode: PresentationMode) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse(source);
	const instance = mount(TextEditableBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({
			blockEdit: makeStubBlockEdit(),
			doc: { doc: () => doc },
			policies: { presentationMode: () => mode },
			services: { decorations: noIslands }
		})
	});
	flushSync();
	const el = target.querySelector('.text-editable-block') as HTMLElement;
	el.focus();
	return { instance, el };
}

let mounted: ReturnType<typeof mountText> | undefined;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	mounted = undefined;
	document.body.innerHTML = '';
	window.getSelection()?.removeAllRanges();
});

function pressed(source: string, start: number, end = start, mode: PresentationMode = 'live') {
	mounted = mountText(source, mode);
	mounted.instance.setSelection(start, end);
	return mounted.instance.isCommandActive('link.openCard');
}

describe('the link editor’s pressed state on a prose surface', () => {
	it('a caret inside the link paints pressed', () => {
		expect(pressed(LINKED, 10)).toBe(true);
	});

	it('a caret in the text after it paints nothing', () => {
		expect(pressed(LINKED, 32)).toBe(false);
	});

	it('a selection inside the link text is inside the link', () => {
		expect(pressed(LINKED, 8, 12)).toBe(true);
	});

	it('a selection running out of the link paints nothing', () => {
		expect(pressed(LINKED, 2, 10)).toBe(false);
	});

	it('a selection spanning two adjacent links is inside neither', () => {
		expect(pressed('[a](u)[b](v) tail\n', 1, 8)).toBe(false);
	});

	// The construct's own end is inside it, the boundary the reveal chain and the card entry
	// already share.
	it('the caret at the construct end is still inside it', () => {
		expect(pressed(LINKED, 30)).toBe(true);
	});

	it('outside live mode nothing is pressed: the card is live mode’s alone', () => {
		expect(pressed(LINKED, 10, 10, 'source')).toBe(false);
	});

	it('a mark command keeps answering from its own row', () => {
		mounted = mountText('a **bold** b\n', 'source');
		mounted.instance.setSelection(4, 8);
		expect(mounted.instance.isCommandActive('format.toggleStrong')).toBe(true);
	});
});
