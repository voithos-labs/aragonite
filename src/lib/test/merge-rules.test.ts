// src/lib/editor/test/merge-rules.test.ts
import { describe, it, expect } from 'vitest';
import { isMergeEligible, isBlockEditable } from '../merge-rules';

describe('isMergeEligible', () => {
	const eligible: [string, string][] = [
		['paragraph', 'paragraph'],
		['heading', 'paragraph'],
		['setextHeading', 'paragraph'],
		['unrecognized', 'unrecognized']
	];

	for (const [a, b] of eligible) {
		it(`${a} + ${b} are mergeable`, () => {
			expect(isMergeEligible(a, b)).toBe(true);
		});
	}

	const ineligible: [string, string][] = [
		['heading', 'heading'],
		['paragraph', 'heading'],
		['fencedCode', 'paragraph'],
		['paragraph', 'fencedCode'],
		['thematicBreak', 'paragraph'],
		['table', 'paragraph'],
		['blockquote', 'paragraph'],
		['list', 'paragraph']
	];

	for (const [a, b] of ineligible) {
		it(`${a} + ${b} are NOT mergeable`, () => {
			expect(isMergeEligible(a, b)).toBe(false);
		});
	}
});

describe('isBlockEditable', () => {
	const editable = ['paragraph', 'heading', 'fencedCode', 'blockquote', 'list', 'listItem'];

	for (const kind of editable) {
		it(`${kind} is editable`, () => {
			expect(isBlockEditable(kind)).toBe(true);
		});
	}

	it('thematicBreak is NOT editable', () => {
		expect(isBlockEditable('thematicBreak')).toBe(false);
	});
});
