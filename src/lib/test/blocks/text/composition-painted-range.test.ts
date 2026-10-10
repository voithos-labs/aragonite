// @vitest-environment jsdom
// A composition over a selection in live mode replaces only the bytes the block paints.
// Miss-analysis: the composition's range rows drew every selection inside the content, and only
// the keydown route cut a range back from a hidden setext underline.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TextEditableBlock from '#lib/components/blocks/text/TextEditableBlock.svelte';
import { asDomTextOffset } from '#lib/caret/coordinate-spaces.js';
import { createRangeAtDomTextOffsets } from '#lib/caret/widget-offset.js';
import { cleanLiveJoinSeam } from '#lib/components/blocks/text/live-join-seam.js';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '#lib/schema/inline-construct-policy.js';
import { mountBlock } from '../../harness/mount-block';
import { settleEditor } from '../../harness/settle';
import { noIslands } from '../table/mount-cell';

beforeAll(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
// The composition commit reads the mode off the nearest root that names one.
beforeEach(() => {
	document.body.dataset.presentation = 'live';
});
afterEach(() => {
	document.body.innerHTML = '';
	delete document.body.dataset.presentation;
	window.getSelection()?.removeAllRanges();
});
afterAll(() => __resetLiveJoinSeamCleanerForTests());

function select(el: HTMLElement, start: number, end = start): void {
	el.focus();
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(createRangeAtDomTextOffsets(el, asDomTextOffset(start), asDomTextOffset(end))!);
}

describe('a composition over a selection drawn past a setext heading’s text', () => {
	it('replaces the text and keeps the underline', async () => {
		const mounted = mountBlock(TextEditableBlock, {
			source: 'ab\n==\n',
			overrides: {
				policies: { presentationMode: () => 'live' },
				services: { decorations: noIslands }
			}
		});
		const el = mounted.target.querySelector('.text-editable-block') as HTMLElement;
		select(el, 1, 5);
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.textContent = 'ax';
		select(el, 2);
		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		await settleEditor();
		const written = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls.map((c) => c[1]);
		expect(written).toEqual(['ax\n==\n']);
	});
});

describe('a composition over a selection with nothing to clean', () => {
	// The browser's own edit stands, so the caret is the one the browser left, not one the editor set.
	it('keeps the browser’s edit and its caret', async () => {
		const mounted = mountBlock(TextEditableBlock, {
			source: 'ab\n',
			overrides: {
				policies: { presentationMode: () => 'live' },
				services: { decorations: noIslands }
			}
		});
		const el = mounted.target.querySelector('.text-editable-block') as HTMLElement;
		select(el, 0, 1);
		el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		el.textContent = 'xb';
		select(el, 0);
		el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		await settleEditor();
		const calls = vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls;
		expect(calls.map((c) => [c[1], c[4]])).toEqual([['xb\n', 0]]);
	});
});
