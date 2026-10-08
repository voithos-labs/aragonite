// @vitest-environment jsdom
// The input of an element that only holds a caret: typed and composed text become one insert, and
// a composition the browser drops ends at the input that showed it.
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
	it('inserts typed text and a committed composition, leaving the host empty', () => {
		const { el, inserted, input } = host();
		const typed = beforeInput('insertText', 'a', false);
		input.onBeforeInput(typed);
		input.onCompositionStart();
		const composing = beforeInput('insertCompositionText', 'か', true);
		input.onBeforeInput(composing);
		el.textContent = 'か';
		input.onCompositionEnd();

		expect(inserted).toEqual(['a', 'か']);
		expect([typed.defaultPrevented, composing.defaultPrevented]).toEqual([true, false]);
		expect(el.textContent).toBe('');
	});

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
});
