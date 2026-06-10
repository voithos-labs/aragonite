// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { findEnclosingListForPaste } from '$lib/editor/tree-operations/paste/find-enclosing-list';

describe('findEnclosingListForPaste', () => {
	it('finds nearest list ancestor', () => {
		const doc = parse('- a\n- b\n');
		const result = findEnclosingListForPaste(doc, [0, 0, 0]);
		expect(result).not.toBeNull();
		expect(result!.itemIndex).toBe(0);
		expect(result!.innerIndex).toBe(0);
		expect(result!.listPath).toEqual([0]);
	});

	it('returns null when no list ancestor exists', () => {
		const doc = parse('paragraph\n');
		const result = findEnclosingListForPaste(doc, [0]);
		expect(result).toBeNull();
	});

	it('returns null for a target nested deeper than a direct item leaf', () => {
		// list > listItem > blockquote > paragraph: the paragraph at [0,0,0,0]
		// is one container deeper than the listItem's direct leaf, so the
		// direct-leaf gate rejects it.
		const doc = parse('- > quote text\n');
		const result = findEnclosingListForPaste(doc, [0, 0, 0, 0]);
		expect(result).toBeNull();
	});
});
