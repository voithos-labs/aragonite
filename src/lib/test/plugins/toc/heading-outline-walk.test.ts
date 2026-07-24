import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { collectHeadings } from '$lib/plugins/toc/heading-outline';

// The walk collects `heading`/`setextHeading` nodes anywhere in the tree, with
// their doc-absolute path and level, filtered by max heading level. "Depth" here
// is heading level (h1–h6), never container-nesting depth.
describe('collectHeadings — level, path, order', () => {
	it('collects both ATX and setext headings in document order with levels', () => {
		const doc = parse('# One\n\n## Two\n\nThree\n=====\n\nbody\n');
		const entries = collectHeadings(doc, 6);
		expect(entries.map((e) => [e.level, e.label])).toEqual([
			[1, 'One'],
			[2, 'Two'],
			[1, 'Three']
		]);
		expect(entries.map((e) => e.path)).toEqual([[0], [1], [2]]);
	});

	it('filters out headings deeper than maxDepth', () => {
		const doc = parse('# H1\n\n## H2\n\n### H3\n\n#### H4\n');
		expect(collectHeadings(doc, 2).map((e) => e.level)).toEqual([1, 2]);
		expect(collectHeadings(doc, 6).map((e) => e.level)).toEqual([1, 2, 3, 4]);
		expect(collectHeadings(doc, 1).map((e) => e.label)).toEqual(['H1']);
	});

	it('recurses into a blockquote to reach a nested heading, with its nested path', () => {
		const doc = parse('# Top\n\n> ## Quoted\n');
		const entries = collectHeadings(doc, 6);
		expect(entries.map((e) => [e.level, e.label])).toEqual([
			[1, 'Top'],
			[2, 'Quoted']
		]);
		expect(entries.map((e) => e.path)).toEqual([[0], [1, 0]]);
	});

	it("a nested heading's level is filtered on its level, not its nesting", () => {
		// The `> ## Sub` is level 2 regardless of sitting inside a container.
		const doc = parse('# Top\n\n> ## Sub\n');
		expect(collectHeadings(doc, 1).map((e) => e.label)).toEqual(['Top']);
	});

	it('assigns each entry a stable, unique id keyed on its path', () => {
		const doc = parse('# One\n\n> ## Two\n');
		expect(collectHeadings(doc, 6).map((e) => e.id)).toEqual(['0', '1.0']);
	});

	it('returns an empty list for a document with no headings, or an absent document', () => {
		expect(collectHeadings(parse('just prose\n'), 6)).toEqual([]);
		expect(collectHeadings(undefined, 6)).toEqual([]);
	});
});
