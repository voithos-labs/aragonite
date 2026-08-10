// @vitest-environment jsdom
//
// Miss-analysis: the cell's destructive edits had unit pins for the escape half only and the e2e
// cell rows drove paste alone, so every non-paste cut stayed byte-literal in live mode unseen.
// The seam contract: a live cut through hidden delimiter runs drops what it strands
// (live-mode.md § 4.5), on
// every destructive path — event cut, menu cut, and the native type-over/delete of a selection.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import { mountCell, type MountedCell } from './mount-cell';

beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterAll(() => __resetLiveJoinSeamCleanerForTests());

// Raw `**bold** *it*`: [4, 11) runs from inside the bold out past the italic's opener, so a
// byte-literal cut strands the `**` opener and the italic's closer.
const MIXED = '**bold** *it*';

let mounted: MountedCell;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	document.body.innerHTML = '';
});

const LIVE = { presentationMode: () => 'live' as const };

function committedCalls(cell: MountedCell): unknown[][] {
	return vi.mocked(cell.blockEdit.updateBlockContent).mock.calls;
}

// The cut/beforeinput handlers await the shared prelude before committing, so the
// commit lands several microtasks after dispatch.
async function settleCommit(cell: MountedCell): Promise<void> {
	for (let i = 0; i < 8 && committedCalls(cell).length === 0; i++) await tick();
}

function dispatchCut(el: HTMLElement): Map<string, string> {
	const store = new Map<string, string>();
	const e = new Event('cut', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', {
		value: {
			setData: (t: string, v: string) => void store.set(t, v),
			getData: (t: string) => store.get(t) ?? ''
		}
	});
	el.dispatchEvent(e);
	return store;
}

function dispatchBeforeInput(el: HTMLElement, inputType: string, data?: string): InputEvent {
	const e = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
	el.dispatchEvent(e);
	return e;
}

describe('live mode: every cell cut crosses the join seam', () => {
	it('the clipboard cut drops the runs it strands and copies the raw slice', async () => {
		mounted = mountCell(MIXED, LIVE);
		mounted.el.focus();
		mounted.instance.setSelection(4, 11);

		const clipboard = dispatchCut(mounted.el);
		await settleCommit(mounted);

		expect(clipboard.get('text/plain')).toBe('ld** *i');
		expect(committedCalls(mounted)).toEqual([[0, 'bot', 4, 2]]);
	});

	it('the context-menu cut takes the same seam', async () => {
		document.execCommand = vi.fn(() => true);
		mounted = mountCell(MIXED, LIVE);
		mounted.el.focus();

		await mounted.ref().applyMenuClipboard!('cut', { start: 4, end: 11 });

		expect(committedCalls(mounted)).toEqual([[0, 'bot', 4, 2]]);
	});

	it('typing over the selection lands the character at the cleaned seam', async () => {
		mounted = mountCell(MIXED, LIVE);
		mounted.el.focus();
		mounted.instance.setSelection(4, 11);

		const e = dispatchBeforeInput(mounted.el, 'insertText', 'X');
		await settleCommit(mounted);

		expect(e.defaultPrevented).toBe(true);
		expect(committedCalls(mounted)).toEqual([[0, 'boXt', 4, 3]]);
	});

	it('a native Backspace over the selection takes the same seam', async () => {
		mounted = mountCell(MIXED, LIVE);
		mounted.el.focus();
		mounted.instance.setSelection(4, 11);

		const e = dispatchBeforeInput(mounted.el, 'deleteContentBackward');
		await settleCommit(mounted);

		expect(e.defaultPrevented).toBe(true);
		expect(committedCalls(mounted)).toEqual([[0, 'bot', 4, 2]]);
	});

	it('an escape ahead of the cut survives the seam', async () => {
		mounted = mountCell('a\\|b **bold** *it*', LIVE);
		mounted.el.focus();
		mounted.instance.setSelection(9, 16);

		dispatchCut(mounted.el);
		await settleCommit(mounted);

		expect(committedCalls(mounted)).toEqual([[0, 'a\\|b bot', 9, 7]]);
	});
});

describe('source mode: the same cuts stay byte-literal', () => {
	it('the clipboard cut keeps the delimiters the user aimed at', async () => {
		mounted = mountCell(MIXED);
		mounted.el.focus();
		mounted.instance.setSelection(4, 11);

		dispatchCut(mounted.el);
		await settleCommit(mounted);

		expect(committedCalls(mounted)).toEqual([[0, '**bot*', 4, 4]]);
	});

	it('type-over stays native, so grapheme and IME behavior are untouched', async () => {
		mounted = mountCell(MIXED);
		mounted.el.focus();
		mounted.instance.setSelection(4, 11);

		const e = dispatchBeforeInput(mounted.el, 'insertText', 'X');
		for (let i = 0; i < 8; i++) await tick();

		expect(e.defaultPrevented).toBe(false);
		expect(committedCalls(mounted)).toEqual([]);
	});
});
