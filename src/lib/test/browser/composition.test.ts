// @vitest-environment jsdom
// Miss-analysis: four holders kept their own composing flag, each tested alone, so no row held
// them to one answer, and a holder that never asked at a key (the gap caret) went unseen.
import { afterEach, describe, expect, it } from 'vitest';
import {
	createCompositionTracker,
	imeOwnsKey,
	type CompositionOwner,
	type CompositionTracker
} from '../../browser/composition';
import { takeDevWarns } from '../support/warn-gate';

const teardowns: (() => void)[] = [];
afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
	document.body.innerHTML = '';
});

function editor(): { root: HTMLElement; tracker: CompositionTracker; surface(): Surface } {
	const root = document.createElement('div');
	document.body.append(root);
	const tracker = createCompositionTracker();
	teardowns.push(tracker.install(root));
	return {
		root,
		tracker,
		surface: () => {
			const el = document.createElement('div');
			root.append(el);
			const drops: string[] = [];
			const owner: CompositionOwner = { el, dropped: (signal) => drops.push(signal.type) };
			return { el, owner, drops };
		}
	};
}

interface Surface {
	el: HTMLElement;
	owner: CompositionOwner;
	drops: string[];
}

const key = (init: KeyboardEventInit & { keyCode?: number }) => {
	const e = new KeyboardEvent('keydown', { bubbles: true, ...init });
	if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
	return e;
};
const input = (type: 'beforeinput' | 'input', inputType: string, isComposing: boolean) =>
	new InputEvent(type, { bubbles: true, inputType, data: 'x', isComposing });
const compositionStart = () => new CompositionEvent('compositionstart', { bubbles: true });
const compositionEnd = () => new CompositionEvent('compositionend', { bubbles: true });

/** A composition opened at `s`, as its element's compositionstart handler opens it. */
function open(t: CompositionTracker, s: Surface): void {
	s.el.dispatchEvent(compositionStart());
	t.start(s.owner);
}

describe('imeOwnsKey', () => {
	it.each([
		['a key inside a composition', key({ key: 'a', isComposing: true }), true],
		['the opening key, named Process', key({ key: 'Process' }), true],
		['the opening key as a letter with code 229', key({ key: 'n', keyCode: 229 }), true],
		['a soft keyboard key with no name', key({ key: 'Unidentified', keyCode: 229 }), true],
		['a plain letter', key({ key: 'n', keyCode: 78 }), false],
		['Enter', key({ key: 'Enter', keyCode: 13 }), false]
	])('%s: %s', (_name, e, owned) => {
		expect(imeOwnsKey(e)).toBe(owned);
	});
});

describe('the composition tracker', () => {
	it('opens at the element that started it and closes at its compositionend', () => {
		const { tracker, surface } = editor();
		const a = surface();
		open(tracker, a);
		expect([tracker.live(), tracker.openIn(a.el)]).toEqual([true, true]);
		expect(tracker.end(a.owner)).toBe(true);
		expect([tracker.live(), tracker.openIn(a.el)]).toEqual([false, false]);
		expect(a.drops).toEqual([]);
	});

	it('holds a start a range claimed as live with no owner, until a run adopts it', () => {
		const { tracker, surface } = editor();
		const [a, b] = [surface(), surface()];
		a.el.dispatchEvent(compositionStart());
		tracker.start(null);
		expect([tracker.live(), tracker.openIn(a.el), tracker.openIn(b.el)]).toEqual([
			true,
			false,
			false
		]);

		expect(tracker.adopt(input('beforeinput', 'insertCompositionText', true), b.owner)).toBe(true);
		expect(tracker.openIn(b.el)).toBe(true);
		expect(tracker.adopt(input('beforeinput', 'insertCompositionText', true), b.owner)).toBe(false);
		expect(tracker.end(b.owner)).toBe(true);
	});

	it('adopts only a composed run still composing', () => {
		const { tracker, surface } = editor();
		const b = surface();
		for (const e of [
			input('beforeinput', 'insertText', true),
			input('beforeinput', 'insertFromComposition', true),
			input('beforeinput', 'insertCompositionText', false)
		]) {
			expect(tracker.adopt(e, b.owner)).toBe(false);
		}
	});

	// Miss-analysis (G1.27): a claimed start the IME abandoned with no run ended unpaired.
	it('takes a claimed start ended with no run as paired', () => {
		const { tracker, surface } = editor();
		const a = surface();
		a.el.dispatchEvent(compositionStart());
		tracker.start(null);
		expect(tracker.end(a.owner)).toBe(true);
		expect(tracker.end(a.owner)).toBe(false);
	});

	it.each([
		['a plain key', () => key({ key: 'Enter', keyCode: 13 }), 'keydown'],
		['typed text at beforeinput', () => input('beforeinput', 'insertText', false), 'beforeinput'],
		['typed text at input', () => input('input', 'insertText', false), 'input'],
		['a second compositionstart', compositionStart, 'compositionstart']
	])('ends a composition the browser dropped at %s, once', (_name, signal, type) => {
		const { tracker, surface } = editor();
		const a = surface();
		open(tracker, a);
		const e = signal();
		a.el.dispatchEvent(e);
		expect(a.drops).toEqual([type]);
		expect(tracker.endedBy(e)).toBe(true);
		expect(tracker.openIn(a.el)).toBe(false);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['composition']);
	});

	it.each([
		['a key inside it', () => key({ key: 'Backspace', isComposing: true })],
		[
			'the feeding key Chromium and WebKit send with code 229',
			() => key({ key: 'a', keyCode: 229 })
		],
		['a key named Process', () => key({ key: 'Process' })],
		[
			"a key's own beforeinput saying it isn't composing",
			() => input('beforeinput', 'deleteContentBackward', false)
		],
		['a composed run', () => input('beforeinput', 'insertCompositionText', true)]
	])('keeps the composition open through %s', (_name, signal) => {
		const { tracker, surface } = editor();
		const a = surface();
		open(tracker, a);
		a.el.dispatchEvent(signal());
		expect(tracker.openIn(a.el)).toBe(true);
		expect(a.drops).toEqual([]);
	});

	it('hears a drop at any element in the root, not only the owner', () => {
		const { root, tracker, surface } = editor();
		const a = surface();
		open(tracker, a);
		root.dispatchEvent(key({ key: 'ArrowDown', keyCode: 40 }));
		expect(a.drops).toEqual(['keydown']);
		takeDevWarns();
	});

	it('lets an owner whose element left the document go without a commit or a warning', () => {
		const { tracker, surface } = editor();
		const [a, b] = [surface(), surface()];
		open(tracker, a);
		a.el.remove();
		b.el.dispatchEvent(key({ key: 'x', keyCode: 88 }));
		expect([a.drops, takeDevWarns()]).toEqual([[], []]);
		expect(tracker.live()).toBe(false);
	});

	it('ends the open composition when a run arrives at another element', () => {
		const { tracker, surface } = editor();
		const [a, b] = [surface(), surface()];
		open(tracker, a);
		expect(tracker.adopt(input('beforeinput', 'insertCompositionText', true), b.owner)).toBe(true);
		expect(a.drops).toEqual(['beforeinput']);
		expect(tracker.openIn(b.el)).toBe(true);
		takeDevWarns();
	});

	it('closes a composition outside every owner at its compositionend', () => {
		const { root, tracker } = editor();
		const field = document.createElement('input');
		root.append(field);
		field.dispatchEvent(compositionStart());
		expect(tracker.live()).toBe(true);
		field.dispatchEvent(compositionEnd());
		expect(tracker.live()).toBe(false);
	});

	it('tells a subscriber each time the composition opens, moves or closes', () => {
		const { tracker, surface } = editor();
		const [a, b] = [surface(), surface()];
		let calls = 0;
		teardowns.push(tracker.subscribe(() => calls++));
		open(tracker, a);
		expect(calls).toBe(2);
		tracker.adopt(input('beforeinput', 'insertCompositionText', true), b.owner);
		tracker.end(b.owner);
		expect(calls).toBe(5);
		takeDevWarns();
	});
});
