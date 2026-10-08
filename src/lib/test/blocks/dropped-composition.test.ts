// @vitest-environment jsdom
// A composition the browser drops, ending with a non-composing input and no `compositionend`, ends
// there: the block writes the input and every later one.
// Miss-analysis: every composition test sent its `compositionend`, so a block whose composition
// never ended was never seen to stop writing.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto
} from '$lib/test/harness/mount-editor.svelte';
import { takeDevWarns } from '../support/warn-gate';

beforeAll(() => {
	installLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

function input(el: HTMLElement, text: string, init: InputEventInit): void {
	el.textContent = text;
	placeCaret(el, text.length);
	el.dispatchEvent(new InputEvent('input', { bubbles: true, ...init }));
}

describe('a dropped composition', () => {
	for (const mode of ['source', 'live'] as const) {
		it(`ends at the first non-composing input and the block keeps writing (${mode})`, async () => {
			const editor = mountEditor({ source: 'hello\n', presentationMode: mode });
			const el = surfaceAt(editor, [0]);
			placeCaret(el, 5);
			el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
			input(el, 'helloか', { inputType: 'insertCompositionText', data: 'か', isComposing: true });
			await editor.settle();
			expect(editor.source()).toBe('hello\n');

			input(el, 'helloかx', { inputType: 'insertText', data: 'x', isComposing: false });
			await editor.settle();
			expect(editor.source()).toBe('helloかx\n');
			expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);

			typeInto(el, 'helloかxy');
			await editor.settle();
			expect(editor.source()).toBe('helloかxy\n');
		});
	}
});
