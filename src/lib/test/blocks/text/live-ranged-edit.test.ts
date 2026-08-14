// @vitest-environment jsdom
//
// Every destructive gesture a prose surface can receive, at the entry layer that decides whether
// it reaches the join seam. Ctrl+Backspace beside a hidden run is the shape that shipped: the
// caret-edge arm declines a chorded press, so it arrives as `beforeinput` at a COLLAPSED caret
// whose target range is the whole word. Miss-analysis: the seam's own suite drives ranges
// directly, and this layer had no test at all — so the two gates that fail open (a null live
// selection, and a three-element inputType list) were invisible to every suite.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeFromOffsets } from '$lib/cursor/content-offsets';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import { registerLiveJoinSeamCleaner } from '$lib/schema/inline-construct-policy';
import type { EditorServices } from '$lib/editor-keys';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';
import { mountCell, type MountedCell } from '../table/mount-cell';

const noIslands = { islandsForPath: () => [] } as unknown as EditorServices['decorations'];

/** The async beforeinput chain resolves after the dispatch returns. */
const settle = () => new Promise((r) => setTimeout(r));

// `**bold** tail`: the run is [0,2) and [6,8), the word `bold` is [2,6).
const BOLD = '**bold** tail\n';

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
			policies: { presentationMode: () => 'live' },
			services: { decorations: noIslands }
		})
	});
	flushSync();
	return { instance, el: target.querySelector('.text-editable-block') as HTMLElement, blockEdit };
}

function seat(el: HTMLElement, start: number, end: number): void {
	el.focus();
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(createRangeFromOffsets(el, asDomTextOffset(start), asDomTextOffset(end))!);
}

/** A press the engine reports a target range for — what a word or line delete is, whether or not
 *  anything is selected. `target` omitted leaves the surface to read the live selection. */
async function press(
	el: HTMLElement,
	inputType: string,
	target?: { start: number; end: number },
	data?: string
): Promise<InputEvent> {
	const e = new InputEvent('beforeinput', {
		inputType,
		...(data === undefined ? {} : { data }),
		bubbles: true,
		cancelable: true
	});
	if (target) {
		const range = createRangeFromOffsets(
			el,
			asDomTextOffset(target.start),
			asDomTextOffset(target.end)
		);
		Object.defineProperty(e, 'getTargetRanges', { value: () => [range] });
	}
	el.dispatchEvent(e);
	await settle();
	return e;
}

const committed = (blockEdit: ReturnType<typeof makeStubBlockEdit>) =>
	vi.mocked(blockEdit.updateBlockContent).mock.calls.map((call) => call[1]);

let mounted: ReturnType<typeof mountText> | null = null;
let cell: MountedCell | null = null;

registerLiveJoinSeamCleaner(cleanLiveJoinSeam);

afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	if (cell) await cell.dispose();
	mounted = null;
	cell = null;
	document.body.innerHTML = '';
});

describe('a destructive chord at a collapsed caret reaches the join seam', () => {
	// The word delete reports `bold`; the literal cut leaves `**** tail`, four asterisks the reader
	// can neither see nor remove.
	it.each([
		['deleteWordBackward', { start: 2, end: 6 }],
		['deleteWordForward', { start: 2, end: 6 }],
		['deleteSoftLineBackward', { start: 0, end: 6 }],
		['deleteHardLineBackward', { start: 0, end: 6 }],
		['deleteByDrag', { start: 2, end: 6 }]
	] as const)('%s takes the stranded run with it', async (inputType, target) => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, inputType, target);

		expect(e.defaultPrevented).toBe(true);
		expect(committed(mounted.blockEdit)).toEqual([' tail\n']);
	});

	// A spellcheck replacement is the same range question with a payload.
	it('insertReplacementText writes its text at the cleaned seam', async () => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, 'insertReplacementText', { start: 2, end: 6 }, 'brave');

		expect(e.defaultPrevented).toBe(true);
		expect(committed(mounted.blockEdit)).toEqual(['brave tail\n']);
	});

	// A payload only a `dataTransfer` carries would reach the re-parse without the paste transforms
	// (G4.11), so the press is taken and nothing is written — never turned into a delete.
	it('swallows a replacement whose text it may not read', async () => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, 'insertReplacementText', { start: 2, end: 6 });

		expect(e.defaultPrevented).toBe(true);
		expect(committed(mounted.blockEdit)).toEqual([]);
	});
});

describe('the same gestures over a real selection', () => {
	// The engines that report no target range fall back to the selection, which is the only reader
	// the surface had.
	it('reads the live selection when the event reports no target range', async () => {
		mounted = mountText(BOLD);
		seat(mounted.el, 2, 6);
		const e = await press(mounted.el, 'deleteWordBackward');

		expect(e.defaultPrevented).toBe(true);
		expect(committed(mounted.blockEdit)).toEqual([' tail\n']);
	});
});

describe('what the arm leaves to the engine', () => {
	it('a range crossing no hidden run', async () => {
		mounted = mountText('plain words here\n');
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, 'deleteWordBackward', { start: 0, end: 6 });

		expect(e.defaultPrevented).toBe(false);
		expect(committed(mounted.blockEdit)).toEqual([]);
	});

	// Paste and composition carry seams of their own; claiming them here handles them twice.
	it.each(['insertFromPaste', 'insertCompositionText'] as const)('%s', async (inputType) => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, inputType, { start: 2, end: 6 }, 'x');

		expect(e.defaultPrevented).toBe(false);
		expect(committed(mounted.blockEdit)).toEqual([]);
	});
});

describe('the table cell takes the same arm', () => {
	it('a word delete at a collapsed caret crosses the seam there too', async () => {
		cell = mountCell('**bold** tail', { presentationMode: () => 'live' });
		seat(cell.el, 6, 6);
		const e = await press(cell.el, 'deleteWordBackward', { start: 2, end: 6 });

		expect(e.defaultPrevented).toBe(true);
		expect(committed(cell.blockEdit)).toEqual([' tail']);
	});
});
