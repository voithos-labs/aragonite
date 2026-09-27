// @vitest-environment jsdom
// The IME composition window driven through the shared editable core in browser order: input
// inside the window never commits, the end commits once with the offsets captured at start, and
// an end with no start warns (G1.27). What the commit then does is in
// `editable-surface-composition-commit.test.ts`.
import { describe, it, expect, afterEach } from 'vitest';

import { takeDevWarns } from '../support/warn-gate';
import { makeSurface } from '../harness/editable-surface';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('editable surface: the composing gate', () => {
	it('input events inside the window never commit; the end commits the DOM text once', () => {
		const { surface, commits, el } = makeSurface();
		el.textContent = 'hello';
		surface.onCompositionStart();

		el.textContent = 'helloか';
		surface.onInput();
		el.textContent = 'helloかん';
		surface.onInput();
		expect(commits).toHaveLength(0);

		surface.onCompositionEnd();
		expect(commits.map((c) => c.text)).toEqual(['helloかん']);
	});

	it('the offsets captured at start survive a caret the IME moved mid-window', () => {
		const { surface, commits, el, setCaret } = makeSurface();
		el.textContent = 'hello';
		setCaret(5);
		surface.onCompositionStart();

		// The IME advances the caret as it composes, and its beforeinput events are gated on the
		// composing flag, so 5 must survive.
		setCaret(7);
		surface.onBeforeInput(new InputEvent('beforeinput', { inputType: 'insertCompositionText' }));
		el.textContent = 'helloかん';
		surface.onCompositionEnd();

		expect(commits).toEqual([{ text: 'helloかん', preEdit: 5, saved: 7 }]);
	});

	it('input after the window closes commits normally again', () => {
		const { surface, commits, el } = makeSurface();
		el.textContent = 'hello';
		surface.onCompositionStart();
		surface.onCompositionEnd();

		el.textContent = 'hello!';
		surface.onInput();
		expect(commits.map((c) => c.text)).toEqual(['hello', 'hello!']);
	});
});

describe('editable surface: composition window (G1.27)', () => {
	it('compositionend with no open composition fires', () => {
		const { surface } = makeSurface();
		surface.onCompositionEnd();
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(['invariant:composition-window']);
		expect(fires[0].details).toBe('end-without-start');
	});

	it('a paired start → end cycle stays silent', () => {
		const { surface } = makeSurface();
		surface.onCompositionStart();
		surface.onCompositionEnd();
		expect(takeDevWarns()).toEqual([]);
	});
});
