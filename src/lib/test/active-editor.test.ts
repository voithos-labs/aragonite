// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerEditor,
	unregisterEditor,
	markEditorInteracted,
	claimsBodyChord,
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
