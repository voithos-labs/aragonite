// @vitest-environment jsdom
// Every write the code block makes to its own text records the caret from before the gesture as
// its undo caret, whichever key, input or clipboard route wrote it.
// Miss-analysis: the undo suites read back bytes and entry counts, and the one caret suite drove
// commands over body-only selections, where the caret after a clamped delete equals the one before.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import type { PresentationMode } from '$lib/presentation-mode';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey, settleEditor } from '$lib/test/harness/settle';
import { newestEntryCaret } from '../../support/undo-entry';

beforeAll(() => {
	installLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** A `beforeinput` as the browser sends it, its target range the live selection. */
function beforeInput(el: HTMLElement, inputType: string, data?: string): void {
	const sel = window.getSelection()!.getRangeAt(0);
	const e = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
	Object.defineProperty(e, 'getTargetRanges', { value: () => [sel] });
	el.dispatchEvent(e);
}

/** Selects across the hidden opener line, which a keyboard select-all inside the block does. */
function selectFromOpener(el: HTMLElement, end: number): void {
	const range = createRangeAtDomTextOffsets(el, asDomTextOffset(0), asDomTextOffset(end));
	el.focus();
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range!);
}

interface AnchorRoute {
	name: string;
	mode: PresentationMode;
	source: string;
	/** Puts the caret or selection the gesture starts from, and returns the caret undo restores. */
	place(el: HTMLElement): number;
	gesture(el: HTMLElement): Promise<unknown> | void;
}

const caretAt =
	(offset: number) =>
	(el: HTMLElement): number => {
		placeCaret(el, offset);
		return offset;
	};

const ROUTES: AnchorRoute[] = [
	{
		name: 'Enter',
		mode: 'source',
		source: '```\nab\n```\n',
		place: caretAt(5),
		gesture: (el) => pressKey(el, { key: 'Enter' })
	},
	{
		name: 'Enter between empty brackets',
		mode: 'source',
		source: '```\n{}\n```\n',
		place: caretAt(5),
		gesture: (el) => pressKey(el, { key: 'Enter' })
	},
	{
		name: 'Enter completing a bare fence',
		mode: 'source',
		source: '```\n```\n',
		place: caretAt(3),
		gesture: (el) => pressKey(el, { key: 'Enter' })
	},
	{
		name: 'Backspace inside an empty pair',
		mode: 'source',
		source: '```\n()\n```\n',
		place: caretAt(5),
		gesture: (el) => pressKey(el, { key: 'Backspace' })
	},
	{
		name: 'a soft break',
		mode: 'source',
		source: '```\nab\n```\n',
		place: caretAt(5),
		gesture: (el) => beforeInput(el, 'insertLineBreak')
	},
	{
		name: 'a bracket typed with its closer',
		mode: 'source',
		source: '```\nab\n```\n',
		place: caretAt(6),
		gesture: (el) => beforeInput(el, 'insertText', '(')
	},
	{
		name: 'a bracket typed over a selection',
		mode: 'source',
		source: '```\nab\n```\n',
		place: (el) => {
			selectRange(el, 4, 6);
			return 4;
		},
		gesture: (el) => beforeInput(el, 'insertText', '(')
	},
	{
		name: 'a delete reaching the hidden closer',
		mode: 'live',
		source: '```\nab\n```\n',
		place: (el) => {
			selectRange(el, 5, 9);
			return 5;
		},
		gesture: (el) => beforeInput(el, 'deleteContentBackward')
	},
	{
		name: 'a cut from the hidden opener',
		mode: 'live',
		source: '```\nab\n```\n',
		place: (el) => {
			selectFromOpener(el, 6);
			return 0;
		},
		gesture: (el) => void el.dispatchEvent(new Event('cut', { bubbles: true, cancelable: true }))
	},
	{
		name: 'a composition over the hidden opener',
		mode: 'live',
		source: '```\nab\n```\n',
		place: (el) => {
			selectFromOpener(el, 6);
			return 0;
		},
		gesture: (el) =>
			void el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
	},
	{
		name: 'a bare fence completed as the caret arrives',
		mode: 'live',
		source: '```\n```\n',
		place: caretAt(3),
		gesture: () => {}
	}
];

describe('a code block write’s undo caret is the caret before the gesture', () => {
	for (const route of ROUTES) {
		it(route.name, async () => {
			const editor: MountedEditor = mountEditor({
				source: route.source,
				presentationMode: route.mode
			});
			const el = surfaceAt(editor, [0]);
			const before = route.place(el);

			await route.gesture(el);
			await settleEditor();

			expect(editor.source()).not.toBe(route.source);
			expect(newestEntryCaret(editor)).toEqual({ path: [0], offset: before });
		});
	}
});
