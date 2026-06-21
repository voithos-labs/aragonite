import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { createSearchState } from '../../reactivity/search-state.svelte';

const stubReplace = { replaceOne: async () => {}, replaceAll: async () => {} };

describe('SearchState', () => {
	it('rescans on query change and counts matches', () => {
		const doc = parse('cat cat dog\n');
		const s = createSearchState({
			getDoc: () => doc,
			replace: stubReplace,
			reveal: async () => null
		});
		s.open();
		s.setQuery('cat');
		expect(s.matches.length).toBe(2);
		expect(s.activeIndex).toBe(0);
	});
	it('next/prev wrap around', () => {
		const doc = parse('a a a\n');
		const s = createSearchState({
			getDoc: () => doc,
			replace: stubReplace,
			reveal: async () => null
		});
		s.open();
		s.setQuery('a');
		s.next();
		s.next();
		expect(s.activeIndex).toBe(2);
		s.next();
		expect(s.activeIndex).toBe(0); // wrap
		s.prev();
		expect(s.activeIndex).toBe(2); // wrap back
	});
	it('sets error and clears matches on invalid regex', () => {
		const doc = parse('text\n');
		const s = createSearchState({
			getDoc: () => doc,
			replace: stubReplace,
			reveal: async () => null
		});
		s.open();
		s.setOptions({ regex: true });
		s.setQuery('(');
		expect(s.error).not.toBeNull();
		expect(s.matches.length).toBe(0);
	});
});
