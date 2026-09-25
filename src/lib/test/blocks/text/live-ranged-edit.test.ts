// @vitest-environment jsdom
//
// Every destructive gesture a prose block can receive, at the point that decides whether it
// reaches the join rules: the caret-edge branch declines a chorded key, so it arrives as
// `beforeinput` at a collapsed caret whose target range is the whole word.
// Miss-analysis: the join rules' own suite drives ranges directly and this layer had no test at
// all, so both checks that fail open (a null selection, a three-entry input-type list) were unseen.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { unmount } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeFromOffsets } from '$lib/cursor/content-offsets';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import { registerLiveJoinSeamCleaner } from '$lib/schema/inline-construct-policy';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { mountCell, noIslands, type MountedCell } from '../table/mount-cell';
import { settleEditor } from '$lib/test/harness/settle';
import { mountBlock } from '../../harness/mount-block';

// `**bold** tail`: the run is [0,2) and [6,8), the word `bold` is [2,6).
const BOLD = '**bold** tail\n';

function mountText(source: string) {
	const { instance, target, blockEdit } = mountBlock(TextEditableBlock, {
		source,
		overrides: {
			policies: { presentationMode: () => 'live' },
			services: { decorations: noIslands }
		}
	});
	return { instance, el: target.querySelector('.text-editable-block') as HTMLElement, blockEdit };
}

function seat(el: HTMLElement, start: number, end: number): void {
	el.focus();
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(createRangeFromOffsets(el, asDomTextOffset(start), asDomTextOffset(end))!);
}

/** A key the browser reports a target range for, which is what a word or line delete is, whether
 *  or not anything is selected. Omitting `target` leaves the block to read the live selection. */
async function press(
	el: HTMLElement,
	inputType: string,
	target?: { start: number; end: number },
	data?: string,
	init: InputEventInit = {}
): Promise<InputEvent> {
	const e = new InputEvent('beforeinput', {
		inputType,
		...(data === undefined ? {} : { data }),
		bubbles: true,
		cancelable: true,
		...init
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
	await settleEditor();
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

describe('a destructive chord at a collapsed caret reaches the join', () => {
	// The word delete reports `bold`; the literal cut leaves `**** tail`, four asterisks the user
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

	// A spellcheck replacement is the same range question with a payload. The range crosses the
	// closer, so the opener is stranded whatever the payload does and the cleanup takes it.
	it('insertReplacementText writes its text at the cleaned join', async () => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, 'insertReplacementText', { start: 2, end: 10 }, 'X');

		expect(e.defaultPrevented).toBe(true);
		expect(committed(mounted.blockEdit)).toEqual(['Xail\n']);
	});

	// The payload is part of what the cleanup checks (GH #165): `**brave**` strands nothing, so it
	// refuses and the replacement stays inside the run the user saw.
	it('leaves a replacement that fills the run to the browser', async () => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, 'insertReplacementText', { start: 2, end: 6 }, 'brave');

		expect(e.defaultPrevented).toBe(false);
		expect(committed(mounted.blockEdit)).toEqual([]);
	});

	// A payload carried only on a `dataTransfer` would reach the reparse without the paste
	// transforms (G4.11), so the key is consumed and nothing is written, never made into a delete.
	it('swallows a replacement whose text it may not read', async () => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, 'insertReplacementText', { start: 2, end: 6 });

		expect(e.defaultPrevented).toBe(true);
		expect(committed(mounted.blockEdit)).toEqual([]);
	});
});

describe('the same gestures over a real selection', () => {
	// Browsers that report no target range fall back to the selection, which is the only source
	// the block had.
	it('reads the live selection when the event reports no target range', async () => {
		mounted = mountText(BOLD);
		seat(mounted.el, 2, 6);
		const e = await press(mounted.el, 'deleteWordBackward');

		expect(e.defaultPrevented).toBe(true);
		expect(committed(mounted.blockEdit)).toEqual([' tail\n']);
	});
});

describe('what the branch leaves to the browser', () => {
	it('a range crossing no hidden run', async () => {
		mounted = mountText('plain words here\n');
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, 'deleteWordBackward', { start: 0, end: 6 });

		expect(e.defaultPrevented).toBe(false);
		expect(committed(mounted.blockEdit)).toEqual([]);
	});

	// Paste and composition have their own handling; taking one here writes the block twice, once
	// from this branch and once from the composition's own commit over the same range. The delete
	// half of the composition family is what an insert-only list misses.
	it.each([
		'insertFromPaste',
		'insertCompositionText',
		'deleteCompositionText',
		'deleteByComposition'
	] as const)('%s', async (inputType) => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, inputType, { start: 2, end: 6 }, 'x');

		expect(e.defaultPrevented).toBe(false);
		expect(committed(mounted.blockEdit)).toEqual([]);
	});

	// The flag, not the name: a delete dispatched during a composition belongs to the composition
	// whatever the browser calls it, which keeps a future composition input type out of here.
	it('a delete carrying isComposing', async () => {
		mounted = mountText(BOLD);
		seat(mounted.el, 6, 6);
		const e = await press(mounted.el, 'deleteContentBackward', { start: 2, end: 6 }, undefined, {
			isComposing: true
		});

		expect(e.defaultPrevented).toBe(false);
		expect(committed(mounted.blockEdit)).toEqual([]);
	});
});

describe('the table cell takes the same branch', () => {
	it('a word delete at a collapsed caret crosses the join there too', async () => {
		cell = mountCell('**bold** tail', { presentationMode: () => 'live' });
		seat(cell.el, 6, 6);
		const e = await press(cell.el, 'deleteWordBackward', { start: 2, end: 6 });

		expect(e.defaultPrevented).toBe(true);
		expect(committed(cell.blockEdit)).toEqual([' tail']);
	});
});
