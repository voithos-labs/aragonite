// @vitest-environment jsdom
// A shown painted source repaints and reports its new text exactly once per change, whatever made
// it and in whichever order the engine fires an IME commit's events, over both forms of the leaf.
// Miss-analysis: Chromium ends a commit on a composing input, and no row composed in a painted source.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unmount } from 'svelte';
import { installLayoutStubs, placeCaret } from '#lib/test/harness/mount-editor.svelte.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { createRangeAtDomTextOffsets } from '#lib/browser/offsets.js';
import { asDomTextOffset } from '#lib/core/coordinate-spaces.js';
import {
	REVEAL_LEAF_FORMS,
	leafDocument,
	mountRevealLeaf,
	registerRevealLeafKind,
	type RevealLeafForm
} from '../fixtures/reveal-leaf';

const SOURCE = '@@ one';
const COMMITTED = '@@ one漢';

function mountLeaf(form: RevealLeafForm) {
	const paint = vi.fn((text: string) => {
		const frag = document.createDocumentFragment();
		frag.appendChild(document.createElement('span')).textContent = text;
		return frag;
	});
	const reports = vi.fn<(text: string) => void>();
	const kind = registerRevealLeafKind('source-reports-leaf');
	const mounted = mountRevealLeaf(leafDocument(kind, `${SOURCE}\n`), {
		form,
		props: { paint, onSourceEdit: reports }
	});
	return { ...mounted, paint, reports };
}

/** What an IME leaves in the element as it composes: the run typed into the text. */
function compose(el: HTMLElement, text: string): void {
	el.textContent = text;
	placeCaret(el, text.length);
}

const fire = (el: HTMLElement, event: Event) => el.dispatchEvent(event);
const composing = (type: 'compositionstart' | 'compositionend') =>
	new CompositionEvent(type, { bubbles: true });
const input = (isComposing: boolean) =>
	new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing });

let mounted: ReturnType<typeof mountLeaf> | null = null;

beforeEach(installLayoutStubs);
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	mounted = null;
	document.body.innerHTML = '';
});

describe.each(REVEAL_LEAF_FORMS)('a shown painted source drawn by %s', (form) => {
	async function openSource() {
		mounted = mountLeaf(form);
		const el = await mounted.revealAtEnd();
		mounted.paint.mockClear();
		mounted.reports.mockClear();
		return el;
	}

	it('reports nothing mid-composition, then repaints and reports a commit ending on a composing input once', async () => {
		const el = await openSource();
		fire(el, composing('compositionstart'));
		compose(el, '@@ oneか');
		fire(el, input(true));
		compose(el, COMMITTED);
		fire(el, input(true));
		expect(mounted!.reports).not.toHaveBeenCalled();
		fire(el, composing('compositionend'));
		await settleEditor();

		expect(mounted!.reports.mock.calls).toEqual([[COMMITTED]]);
		expect(mounted!.paint.mock.calls).toEqual([[COMMITTED]]);
		expect(el.querySelector('span')?.textContent).toBe(COMMITTED);
	});

	it('repaints and reports once when the compositionend comes before a plain input', async () => {
		const el = await openSource();
		fire(el, composing('compositionstart'));
		compose(el, COMMITTED);
		fire(el, input(true));
		fire(el, composing('compositionend'));
		fire(el, input(false));
		await settleEditor();

		expect(mounted!.reports.mock.calls).toEqual([[COMMITTED]]);
		expect(mounted!.paint.mock.calls).toEqual([[COMMITTED]]);
	});

	it('repaints and reports once after a native input outside a composition', async () => {
		const el = await openSource();
		compose(el, `${SOURCE}!`);
		fire(el, new InputEvent('input', { bubbles: true, inputType: 'insertFromDrop' }));
		await settleEditor();

		expect(mounted!.reports.mock.calls).toEqual([[`${SOURCE}!`]]);
		expect(mounted!.paint.mock.calls).toEqual([[`${SOURCE}!`]]);
	});

	it('reports an edit the leaf applies itself once', async () => {
		const el = await openSource();
		const at = SOURCE.length;
		const e = new InputEvent('beforeinput', {
			inputType: 'insertText',
			data: 'x',
			bubbles: true,
			cancelable: true
		});
		const range = createRangeAtDomTextOffsets(el, asDomTextOffset(at), asDomTextOffset(at));
		Object.defineProperty(e, 'getTargetRanges', { value: () => (range ? [range] : []) });
		fire(el, e);
		await settleEditor();

		expect(mounted!.reports.mock.calls).toEqual([[`${SOURCE}x`]]);
	});
});
