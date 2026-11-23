import { describe, it, expect } from 'vitest';
import { grammar } from '#lib/plugin.js';
import { headingsIn, outlineOf } from '#packages/toc/src/heading-outline.js';

// Collects `heading` and `setextHeading` blocks anywhere in the document, with the top-level
// block each sits in and its level, filtered by maximum heading level. "Depth" here means heading
// level (h1 to h6), never how deeply nested the container is.
function collectHeadings(source: string, maxDepth: number) {
	return outlineOf(grammar([]).parse(source).blocks.map(headingsIn(maxDepth)));
}

describe('the outline: level, place, order', () => {
	it('collects both ATX and setext headings in document order with levels', () => {
		const entries = collectHeadings('# One\n\n## Two\n\nThree\n=====\n\nbody\n', 6);
		expect(entries.map((e) => [e.level, e.label])).toEqual([
			[1, 'One'],
			[2, 'Two'],
			[1, 'Three']
		]);
		expect(entries.map((e) => [e.block, e.nth])).toEqual([
			[0, 0],
			[1, 0],
			[2, 0]
		]);
	});

	// Miss-analysis: every heading was ASCII, never one holding a typed non-breaking space.
	it('trims Markdown whitespace off a label and keeps a non-breaking space', () => {
		expect(collectHeadings('# \u00a0One\t\n', 6).map((e) => e.label)).toEqual(['\u00a0One']);
	});

	// A soft break inside a setext heading stays in its label, so the answer can't split it.
	it('keeps a label that holds a line break whole', () => {
		expect(collectHeadings('One\ntwo\n===\n', 6).map((e) => e.label)).toEqual(['One\ntwo']);
	});

	it('filters out headings deeper than maxDepth', () => {
		const source = '# H1\n\n## H2\n\n### H3\n\n#### H4\n';
		expect(collectHeadings(source, 2).map((e) => e.level)).toEqual([1, 2]);
		expect(collectHeadings(source, 6).map((e) => e.level)).toEqual([1, 2, 3, 4]);
		expect(collectHeadings(source, 1).map((e) => e.label)).toEqual(['H1']);
	});

	it('reaches a heading inside a blockquote, in the quote’s top-level block', () => {
		const entries = collectHeadings('# Top\n\n> ## Quoted\n', 6);
		expect(entries.map((e) => [e.level, e.label])).toEqual([
			[1, 'Top'],
			[2, 'Quoted']
		]);
		expect(entries.map((e) => e.block)).toEqual([0, 1]);
	});

	it('filters a nested heading on its level, not its nesting', () => {
		// The `> ## Sub` is level 2 regardless of sitting inside a container.
		expect(collectHeadings('# Top\n\n> ## Sub\n', 1).map((e) => e.label)).toEqual(['Top']);
	});

	// A heading left out by depth still counts, so `nth` finds the heading a click names.
	it('counts every heading of a block in nth, listed or not', () => {
		const entries = collectHeadings('> ### Deep\n>\n> # Shallow\n', 1);
		expect(entries.map((e) => [e.label, e.nth])).toEqual([['Shallow', 1]]);
	});

	it('gives each entry a unique id by its place', () => {
		expect(collectHeadings('# One\n\n> ## Two\n>\n> ## Three\n', 6).map((e) => e.id)).toEqual([
			'0.0',
			'1.0',
			'1.1'
		]);
	});

	it('returns an empty list for a document with no headings', () => {
		expect(collectHeadings('just prose\n', 6)).toEqual([]);
	});
});
