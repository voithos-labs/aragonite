// @vitest-environment jsdom
// A caret host (the gap caret, a whole-block block's hidden host) ends a composition the browser
// dropped at the signal that showed it, inserting what the composition left once.
import { afterEach, describe, it, expect } from 'vitest';
import { createCaretHostInput } from '#lib/editor-actions/caret-host-input.js';
import { createCompositionTracker } from '#lib/browser/composition.js';
import { takeDevWarns } from '../support/warn-gate';

const teardowns: (() => void)[] = [];
afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
	document.body.innerHTML = '';
});

// The host inside an editor root the tracker listens on, wired the way both hosts wire it.
function host() {
	const root = document.createElement('div');
	const el = document.createElement('div');
	root.append(el);
	document.body.append(root);
	const composition = createCompositionTracker();
	teardowns.push(composition.install(root));
	const inserted: string[] = [];
	const input = createCaretHostInput(
		() => el,
		(text) => inserted.push(text),
		composition,
		() => {}
	);
	el.addEventListener('beforeinput', (e) => input.onBeforeInput(e as InputEvent));
	el.addEventListener('compositionstart', input.onCompositionStart);
	el.addEventListener('compositionend', input.onCompositionEnd);
	return { el, inserted, input };
}

const beforeInput = (inputType: string, data: string, isComposing: boolean) =>
	new InputEvent('beforeinput', { inputType, data, isComposing, cancelable: true, bubbles: true });
const start = () => new CompositionEvent('compositionstart', { bubbles: true });
const end = () => new CompositionEvent('compositionend', { bubbles: true });
const keydown = (key: string, init: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

describe('caret host input', () => {
	it('ends a dropped composition at the non-composing input, inserting once', () => {
		const { el, inserted } = host();
		el.dispatchEvent(start());
		el.textContent = 'k';
		el.dispatchEvent(beforeInput('insertText', '漢', false));

		expect(inserted).toEqual(['k漢']);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);
		el.dispatchEvent(beforeInput('insertText', 'a', false));
		expect(inserted).toEqual(['k漢', 'a']);
	});

	// Miss-analysis: every host composition started in the host, so none arrived with its start
	// claimed by a range across blocks, whose removal put the caret on a rule's host.
	it('a composed run with no composition open opens one, and the end inserts once', () => {
		const { el, inserted } = host();
		el.dispatchEvent(beforeInput('insertCompositionText', 'か', true));
		el.textContent = 'か';
		el.dispatchEvent(beforeInput('insertCompositionText', 'かん', true));
		el.textContent = '漢';
		expect(inserted).toEqual([]);

		el.dispatchEvent(end());
		expect(inserted).toEqual(['漢']);
		expect(takeDevWarns()).toEqual([]);
	});

	it('ends a dropped composition at a second compositionstart', () => {
		const { el, inserted } = host();
		el.dispatchEvent(start());
		el.textContent = 'k';
		el.dispatchEvent(start());

		expect(inserted).toEqual(['k']);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);
	});

	// Miss-analysis (#775): the host asked about a drop only at beforeinput and compositionstart, so
	// the gap caret's Enter after one ran with the composed text still in the host.
	it('ends a dropped composition at a plain key, which the host then spends', async () => {
		const { el, inserted, input } = host();
		el.dispatchEvent(start());
		el.textContent = 'か';
		const enter = keydown('Enter');
		el.dispatchEvent(enter);
		const opened: string[] = [];

		expect(inserted).toEqual(['か']);
		expect(input.takesKey(enter, () => opened.push('after'))).toBe(true);
		expect(enter.defaultPrevented).toBe(true);
		await Promise.resolve();
		expect(opened).toEqual(['after']);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);
	});

	// Miss-analysis: the only key row after a drop pressed Enter, so a letter there ran the host's
	// own insert with the composed paragraph not yet in the host's index, landing before it.
	it('a typed letter that ends a dropped composition joins the composed text', () => {
		const { el, inserted, input } = host();
		el.dispatchEvent(start());
		el.textContent = 'か';
		const x = keydown('x');
		el.dispatchEvent(x);

		expect(inserted).toEqual(['かx']);
		expect(input.takesKey(x, () => {})).toBe(true);
		takeDevWarns();
	});

	it('leaves a chord and a key that ended nothing to the host', () => {
		const { el, input } = host();
		el.dispatchEvent(start());
		el.textContent = 'か';
		const undo = keydown('z', { ctrlKey: true });
		el.dispatchEvent(undo);
		const later = keydown('Backspace');
		el.dispatchEvent(later);

		expect([input.takesKey(undo, () => {}), input.takesKey(later, () => {})]).toEqual([
			false,
			false
		]);
		takeDevWarns();
	});

	it('mints nothing at a key inside the composition', () => {
		const { el, inserted, input } = host();
		el.dispatchEvent(start());
		el.textContent = 'か';
		const enter = keydown('Enter', { isComposing: true });
		el.dispatchEvent(enter);

		expect([inserted, input.takesKey(enter, () => {})]).toEqual([[], false]);
	});
});
