// @vitest-environment jsdom
// G1.163: a caret key the editor decided holds its selection until the next `selectionchange`.
// Miss-analysis: no check watched a decided key's default, so a route that wrote the caret and let
// the browser move it too would show only as a landing a row happened to assert.
import { afterEach, describe, expect, it } from 'vitest';
import { createCaretWriter } from '#lib/browser/caret-writer.js';
import { takeDevWarns } from '../support/warn-gate';

afterEach(() => document.body.replaceChildren());

function writer() {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.textContent = 'hello world';
	document.body.replaceChildren(el);
	el.focus();
	return {
		el,
		writer: createCaretWriter(
			() => {},
			() => false
		)
	};
}

describe('caret-motion-decided (G1.163)', () => {
	it('fires when the live caret is not the one the decided key wrote', () => {
		const { el, writer: w } = writer();
		w.placeCaretAtRaw(el, 5, { clamp: 'exact' });
		w.noteDecidedMotion();
		window.getSelection()!.collapse(el.firstChild, 7);
		w.settleDecidedMotion();
		expect(takeDevWarns().map((each) => each.tag)).toEqual(['invariant:caret-motion-decided']);
	});

	it('stays quiet when the caret is the one written, and checks once', () => {
		const { el, writer: w } = writer();
		w.placeCaretAtRaw(el, 5, { clamp: 'exact' });
		w.noteDecidedMotion();
		w.settleDecidedMotion();
		window.getSelection()!.collapse(el.firstChild, 7);
		w.settleDecidedMotion();
		expect(takeDevWarns()).toEqual([]);
	});
});
