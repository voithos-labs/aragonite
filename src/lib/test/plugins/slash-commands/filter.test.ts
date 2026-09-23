import { describe, expect, it } from 'vitest';
import {
	acceptsQuery,
	filterEntries,
	splitQuery,
	type FilterableEntry
} from '$lib/plugins/slash-commands/filter';

const row = (label: string, keywords: string[] = [], takesArgument = false): FilterableEntry => ({
	label,
	keywords,
	takesArgument
});

const ROWS = [
	row('Bulleted list', ['bullet', 'list']),
	row('To-do list', ['todo', 'td', 'task', 'list']),
	row('Divider', ['rule', 'hr']),
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
