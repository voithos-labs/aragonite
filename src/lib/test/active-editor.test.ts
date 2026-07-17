// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerEditor,
	unregisterEditor,
	markEditorInteracted,
	claimsBodyChord,
	isForeignTextEntry,
	releaseInteractedEditor,
	__resetActiveEditorForTests
} from '$lib/active-editor';

describe('active-editor — body-chord claimant', () => {
	const a = document.createElement('div');
	const b = document.createElement('div');
	beforeEach(() => __resetActiveEditorForTests());

	it('the sole mounted editor claims a body chord even before any interaction', () => {
		registerEditor(a);
		expect(claimsBodyChord(a)).toBe(true);
	});

	it('an unregistered editor never claims', () => {
		expect(claimsBodyChord(a)).toBe(false);
	});

	it('the last-interacted editor claims across two mounted instances', () => {
		registerEditor(a);
		registerEditor(b);
		markEditorInteracted(a);
		expect(claimsBodyChord(a)).toBe(true);
		expect(claimsBodyChord(b)).toBe(false);
		markEditorInteracted(b);
		expect(claimsBodyChord(a)).toBe(false);
		expect(claimsBodyChord(b)).toBe(true);
	});

	it('two mounted editors with no live claim resolve to neither — ambiguous', () => {
		registerEditor(a);
		registerEditor(b);
		expect(claimsBodyChord(a)).toBe(false);
		expect(claimsBodyChord(b)).toBe(false);
	});

	it('a released last-interacted claim falls back to the remaining sole editor', () => {
		registerEditor(a);
		registerEditor(b);
		markEditorInteracted(a);
		releaseInteractedEditor(a);
		unregisterEditor(a);
		expect(claimsBodyChord(b)).toBe(true);
	});

	it('a stale (unmounted, unreleased) claim still yields to the sole survivor', () => {
		registerEditor(a);
		registerEditor(b);
		markEditorInteracted(a);
		unregisterEditor(a); // release skipped — claim points at an unmounted editor
		expect(claimsBodyChord(b)).toBe(true);
	});
});

describe('active-editor — isForeignTextEntry', () => {
	beforeEach(() => __resetActiveEditorForTests());

	const input = (type?: string) => {
		const el = document.createElement('input');
		if (type) el.type = type;
		return el;
	};

	it('null focus is not a text-entry surface', () => {
		expect(isForeignTextEntry(null)).toBe(false);
	});

	it('a foreign <textarea> is a text-entry surface', () => {
		expect(isForeignTextEntry(document.createElement('textarea'))).toBe(true);
	});

	it('a foreign contenteditable host is a text-entry surface', () => {
		const el = document.createElement('div');
		el.setAttribute('contenteditable', '');
		expect(isForeignTextEntry(el)).toBe(true);
	});

	it('an explicit contenteditable="false" host is not a text-entry surface', () => {
		const el = document.createElement('div');
		el.setAttribute('contenteditable', 'false');
		expect(isForeignTextEntry(el)).toBe(false);
	});

	it('a bare <input> (type defaults to text) is a text-entry surface', () => {
		expect(isForeignTextEntry(input())).toBe(true);
	});

	for (const type of ['text', 'search', 'url', 'email', 'tel', 'password', 'number']) {
		it(`a foreign text-like <input type="${type}"> yields the chord`, () => {
			expect(isForeignTextEntry(input(type))).toBe(true);
		});
	}

	// Non-text controls stay claimable so a sole editor keeps Ctrl+F when one holds
	// focus — the presentation-reading toggle is a checkbox.
	for (const type of ['checkbox', 'radio', 'button', 'file', 'range', 'color', 'date']) {
		it(`a foreign non-text <input type="${type}"> keeps the editor's claim`, () => {
			expect(isForeignTextEntry(input(type))).toBe(false);
		});
	}

	it('a text-entry surface inside a registered editor is not foreign', () => {
		const root = document.createElement('div');
		const field = document.createElement('textarea');
		root.appendChild(field);
		registerEditor(root);
		expect(isForeignTextEntry(field)).toBe(false);
	});
});
