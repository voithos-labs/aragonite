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
		composition
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
	it('ends a dropped composition at a plain key, and says the key minted a paragraph', () => {
		const { el, inserted, input } = host();
		el.dispatchEvent(start());
		el.textContent = 'か';
		const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
		el.dispatchEvent(enter);

		expect(inserted).toEqual(['か']);
		expect(input.mintedBy(enter)).not.toBeNull();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);
	});

	it('mints nothing at a key inside the composition', () => {
		const { el, inserted, input } = host();
		el.dispatchEvent(start());
		el.textContent = 'か';
		const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true });
		el.dispatchEvent(enter);

		expect([inserted, input.mintedBy(enter)]).toEqual([[], null]);
	});
});
