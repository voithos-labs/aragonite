// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
	markEditorInteracted,
	isLastInteractedEditor,
	releaseInteractedEditor,
	__resetActiveEditorForTests
} from '$lib/active-editor';

describe('active-editor — document-chord owner', () => {
	const a = document.createElement('div');
	const b = document.createElement('div');
	beforeEach(() => __resetActiveEditorForTests());

	it('last interaction wins across instances', () => {
		markEditorInteracted(a);
		expect(isLastInteractedEditor(a)).toBe(true);
		markEditorInteracted(b);
		expect(isLastInteractedEditor(a)).toBe(false);
		expect(isLastInteractedEditor(b)).toBe(true);
	});

	it('nothing is claimed before any interaction', () => {
		expect(isLastInteractedEditor(a)).toBe(false);
	});

	it('release clears only the holder', () => {
		markEditorInteracted(a);
		releaseInteractedEditor(b); // b never held it — no-op
		expect(isLastInteractedEditor(a)).toBe(true);
		releaseInteractedEditor(a);
		expect(isLastInteractedEditor(a)).toBe(false);
	});
});
