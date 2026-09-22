import { describe, expect, it } from 'vitest';
import {
	findOpening,
	sessionQuery,
	stepActive,
	typedRunStart
} from '$lib/inline-menu/inline-menu-session';
import type { InlineMenuSource } from '$lib/inline-menu/types';

const source = (over: Partial<InlineMenuSource> & { name: string; trigger: string }) =>
	({ items: () => [], ...over }) satisfies InlineMenuSource;

const tag = source({
	name: 'tag',
	trigger: '#',
	opensAt: (raw, pos) => pos === 0 || /[\s(]/.test(raw[pos - 1]),
	accepts: (query) => /^[\w\-/]*$/.test(query)
});
const link = source({ name: 'link', trigger: '[[' });
const bracket = source({ name: 'bracket', trigger: '[' });

describe('typedRunStart', () => {
	it('is where the inserted bytes began, when they end at the caret', () => {
		expect(typedRunStart('see ', 'see #', 5)).toBe(4);
		expect(typedRunStart('see ', 'see #wo', 7)).toBe(4);
		expect(typedRunStart('a  b', 'a # b', 3)).toBe(2);
	});

	it('is null for a caret that only moved', () => {
		expect(typedRunStart('see #', 'see #', 5)).toBeNull();
	});

	it('is null for a deletion', () => {
		expect(typedRunStart('see #w', 'see #', 5)).toBeNull();
	});

	it('is null for bytes that landed somewhere other than before the caret', () => {
		expect(typedRunStart('abc', 'Xabc', 4)).toBeNull();
		expect(typedRunStart('abc', 'abcX', 2)).toBeNull();
	});
});

describe('findOpening', () => {
	it('opens the source whose trigger the run just typed', () => {
		expect(findOpening([tag, link], 'see #', 5, 4)).toEqual({ source: tag, start: 4 });
		expect(findOpening([tag, link], 'see [[', 6, 5)).toEqual({ source: link, start: 4 });
	});

	it('finds nothing in a run that typed no trigger', () => {
		// The `#` was already there: typing on after it is not a press of the trigger.
		expect(findOpening([tag, link], 'see #a', 6, 5)).toBeNull();
		expect(findOpening([tag, link], 'x', 1, 0)).toBeNull();
	});

	it('finds the trigger inside a burst that already carries the query’s first bytes', () => {
		expect(findOpening([tag], 'see #wo', 7, 3)).toEqual({ source: tag, start: 4 });
		expect(findOpening([link], 'see [[meal p', 12, 3)).toEqual({ source: link, start: 4 });
	});

	it('declines a burst whose query the source would not accept', () => {
		expect(findOpening([tag], 'see #wo rk', 10, 3)).toBeNull();
	});

	it('takes the trigger nearest the caret', () => {
		expect(findOpening([tag], '#a #b', 5, 0)).toEqual({ source: tag, start: 3 });
	});

	it('opens on the second byte of a trigger whose first was already there', () => {
		expect(findOpening([link], 'x [[', 4, 3)).toEqual({ source: link, start: 2 });
	});

	it('prefers the longer trigger, whatever order the sources registered in', () => {
		expect(findOpening([bracket, link], 'x [[', 4, 2)?.source).toBe(link);
		expect(findOpening([link, bracket], 'x [[', 4, 2)?.source).toBe(link);
	});

	it('hands the press to a shorter trigger when the longer one declines', () => {
		const picky = source({ name: 'picky', trigger: '[[', opensAt: () => false });
		expect(findOpening([picky, bracket], 'x [[', 4, 2)).toEqual({ source: bracket, start: 3 });
	});

	it('lets a source decline by position: a mid-word hash is not a tag', () => {
		expect(findOpening([tag], 'C#', 2, 1)).toBeNull();
		expect(findOpening([tag], '(#', 2, 1)).toEqual({ source: tag, start: 1 });
	});

	it('ignores a source with an empty trigger, which would open on every keystroke', () => {
		expect(findOpening([source({ name: 'empty', trigger: '' })], 'abc', 3, 2)).toBeNull();
	});
});

describe('sessionQuery', () => {
	const session = { source: 'link', path: [0], start: 4, triggerLength: 2 };

	it('is the text between the trigger and the caret', () => {
		expect(sessionQuery(session, link, 'see [[No', 8)).toBe('No');
		expect(sessionQuery(session, link, 'see [[', 6)).toBe('');
	});

	it('keeps spaces, which a document title is full of', () => {
		expect(sessionQuery(session, link, 'see [[My note', 13)).toBe('My note');
	});

	it('ends once the caret steps in front of the query', () => {
		expect(sessionQuery(session, link, 'see [[No', 5)).toBeNull();
	});

	it('ends once the trigger bytes are gone', () => {
		expect(sessionQuery(session, link, 'see [No', 7)).toBeNull();
	});

	it('ends on a line break by default', () => {
		expect(sessionQuery(session, link, 'see [[No\nmore', 13)).toBeNull();
	});

	it('ends on what the source does not accept', () => {
		const tagSession = { source: 'tag', path: [0], start: 0, triggerLength: 1 };
		expect(sessionQuery(tagSession, tag, '#work', 5)).toBe('work');
		expect(sessionQuery(tagSession, tag, '#work ', 6)).toBeNull();
	});

	it('ends on a caret past the leaf, which a stale selection can report', () => {
		expect(sessionQuery(session, link, 'see [[', 9)).toBeNull();
	});
});

describe('stepActive', () => {
	it('wraps at both ends', () => {
		expect(stepActive(2, 1, 3)).toBe(0);
		expect(stepActive(0, -1, 3)).toBe(2);
		expect(stepActive(0, 1, 3)).toBe(1);
	});

	it('holds at zero over an empty list', () => {
		expect(stepActive(0, 1, 0)).toBe(0);
	});
});
