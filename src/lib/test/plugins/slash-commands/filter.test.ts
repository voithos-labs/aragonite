import { describe, expect, it } from 'vitest';
import {
	acceptsQuery,
	filterEntries,
	readQuery,
	splitQuery,
	type FilterableEntry
} from '#packages/slash-commands/src/filter.js';

const row = (label: string, keywords: string[] = [], takesArgument = false): FilterableEntry => ({
	label,
	keywords,
	takesArgument
});

const ROWS = [
	row('Bulleted list', ['bullet', 'list']),
	row('To-do list', ['todo', 'td', 'task', 'list']),
	row('Divider', ['rule']),
	row('Code block', ['fence'], true),
	row('Table', ['grid'], true),
	row('Tag', [])
];
const labels = (head: string) => filterEntries(ROWS, head).map((r) => r.label);

describe('filterEntries', () => {
	it('matches a label or a keyword prefix, ignoring case', () => {
		expect(labels('td')).toEqual(['To-do list']);
		expect(labels('tod')).toEqual(['To-do list']);
		expect(labels('RU')).toEqual(['Divider']);
		expect(labels('co')).toEqual(['Code block']);
	});

	it('keeps the given order and lists everything for an empty query', () => {
		expect(labels('list')).toEqual(['Bulleted list', 'To-do list']);
		expect(labels('ta')).toEqual(['To-do list', 'Table', 'Tag']);
		expect(labels('')).toHaveLength(ROWS.length);
	});
});

describe('splitQuery', () => {
	it('takes the argument after the first space, or none', () => {
		expect(splitQuery('table 3x4')).toEqual({ head: 'table', argument: '3x4' });
		expect(splitQuery('table ')).toEqual({ head: 'table', argument: '' });
		expect(splitQuery('table')).toEqual({ head: 'table', argument: null });
	});
});

describe('acceptsQuery: the list survives a space only for one argument taker', () => {
	it.each([
		['code js', true],
		['table ', true],
		['tab 3x4', true],
		// Named, but by two rows: `ta` is also the tag's prefix.
		['ta 3x4', false],
		['divider x', false],
		['', true],
		[' ', false],
		['or', true],
		['code js more', false],
		['code\njs', false]
	])('%j → %s', (query, accepted) => {
		expect(acceptsQuery(ROWS, query)).toBe(accepted);
	});
});

// Miss-analysis: every accept row had at most one row per prefix, so no test put a plugin row that
// shares a word (a toc's "Table of contents", a diagram's `chart`) beside an argument taker.
describe('acceptsQuery: a shared prefix leaves the word with the row its head names exactly', () => {
	const shared = [
		...ROWS,
		row('Table of contents', ['toc']),
		row('Diagram', ['mermaid', 'chart']),
		row('Chart', ['plot'], true)
	];

	it.each([
		['table 3x4', true],
		['chart pie', true],
		// Two rows start with `tab`, and neither is named by it exactly.
		['tab 3x4', false],
		['toc x', false]
	])('%j → %s', (query, accepted) => {
		expect(acceptsQuery(shared, query)).toBe(accepted);
	});

	// Miss-analysis: every accept row was one word and an argument, so none typed a label in full.
	it.each([
		['table of', true],
		['table of contents', true],
		['bulleted l', true],
		['bulleted list', true],
		['bulleted x', false]
	])('a query a label starts with, spaces and all: %j → %s', (query, accepted) => {
		expect(acceptsQuery(shared, query)).toBe(accepted);
	});

	it('lists the argument taker first on a trailing space, wherever it sits, and claims no word', () => {
		const later = [row('Table of contents', ['toc']), row('Table', ['grid'], true)];
		const reading = readQuery(later, 'table ');
		expect(reading?.listed.map((r) => r.label)).toEqual(['Table', 'Table of contents']);
		expect(reading?.argument).toBeNull();
		expect(acceptsQuery(ROWS, 'divider ')).toBe(false);
	});

	it('gives the word to the taker a keyword names exactly, beside a row sharing the prefix', () => {
		expect(acceptsQuery([...shared, row('Gridlines')], 'grid 3x4')).toBe(true);
	});

	it('gives the word to neither of two argument takers the head names exactly', () => {
		expect(acceptsQuery([...shared, row('Table data', [], true)], 'table 3x4')).toBe(false);
	});
});
