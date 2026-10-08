// @vitest-environment jsdom
// A caret host (the gap caret, a whole-block block's hidden host) ends a composition the browser
// dropped at the input that showed it, inserting what the composition left with that input's text.
import { describe, it, expect } from 'vitest';
import { createCaretHostInput } from '$lib/editor-actions/caret-host-input';
import { takeDevWarns } from '../support/warn-gate';

function host() {
	const el = document.createElement('div');
	const inserted: string[] = [];
	return {
		el,
		inserted,
		input: createCaretHostInput(
			() => el,
			(text) => inserted.push(text)
		)
	};
}

const beforeInput = (inputType: string, data: string, isComposing: boolean) =>
	new InputEvent('beforeinput', { inputType, data, isComposing, cancelable: true });

describe('caret host input', () => {
	it('ends a dropped composition at the non-composing input, inserting once', () => {
		const { el, inserted, input } = host();
		input.onCompositionStart();
		el.textContent = 'k';
		input.onBeforeInput(beforeInput('insertText', '漢', false));

		expect(inserted).toEqual(['k漢']);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);
		input.onBeforeInput(beforeInput('insertText', 'a', false));
		expect(inserted).toEqual(['k漢', 'a']);
	});

	it('ends a dropped composition at a second compositionstart', () => {
		const { el, inserted, input } = host();
		input.onCompositionStart();
		el.textContent = 'k';
		input.onCompositionStart();

		expect(inserted).toEqual(['k']);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);
	});
});
