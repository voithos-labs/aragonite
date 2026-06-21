import { describe, it, expect } from 'vitest';
import { parse } from '$lib/editor/core/parser';
import { compileMatcher } from '$lib/editor/search/matcher';
import { scanDocument } from '$lib/editor/search/document-scan';

const scan = (src: string, q: string) => {
	const r = compileMatcher(q, { caseSensitive: false, wholeWord: false, regex: false });
	if (!r.ok) throw new Error(r.error);
	return scanDocument(parse(src), r.matcher);
};

describe('scanDocument', () => {
	it('finds matches in top-level leaves with correct paths and offsets', () => {
		const m = scan('hi cat\n\ncat there\n', 'cat');
		expect(m).toEqual([
			{ path: [0], start: 3, end: 6 },
			{ path: [1], start: 0, end: 3 }
		]);
	});
	it('descends into containers and keys matches by the leaf path', () => {
		const m = scan('> quoted cat\n', 'cat');
		expect(m.map((x) => x.path)).toEqual([[0, 0]]); // blockquote → paragraph
	});
	it('does NOT double-count container raw', () => {
		const m = scan('> cat\n', 'cat');
		expect(m.length).toBe(1); // only the inner paragraph, not the blockquote's raw
	});
	it('excludes ambient prefixes (list markers are not in leaf raw)', () => {
		const m = scan('- item\n', '- ');
		expect(m.length).toBe(0);
	});
	it('reaches table cells (table → tableRow → tableCell) without counting row/table raw', () => {
		const m = scan('| name | qty |\n| --- | --- |\n| cat | 2 |\n', 'cat');
		expect(m).toEqual([{ path: [0, 1, 0], start: 0, end: 3 }]);
	});
});
