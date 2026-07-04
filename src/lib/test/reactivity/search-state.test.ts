import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { createSearchState } from '../../reactivity/search-state.svelte';

const stubReplace = { replaceOne: async () => {}, replaceAll: async () => {} };

function makeState(source: string, onClose: () => void = () => {}) {
	const doc = parse(source);
	return createSearchState({
		getDoc: () => doc,
		replace: stubReplace,
		reveal: async () => null,
		onClose
	});
}

describe('SearchState', () => {
	it('rescans on query change and counts matches', () => {
		const s = makeState('cat cat dog\n');
		s.open();
		s.setQuery('cat');
		expect(s.matches.length).toBe(2);
		expect(s.activeIndex).toBe(0);
	});
	it('next/prev wrap around', () => {
		const s = makeState('a a a\n');
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
	it('a changed query restarts navigation at the first match', () => {
		const s = makeState('cat dog cat dog cat dog\n\ncat dog cat dog\n');
		s.open();
		s.setQuery('cat');
		s.next();
		s.next();
		expect(s.activeIndex).toBe(2);
		s.setQuery('dog'); // 5 matches — no clamp, so a stale index would survive
		expect(s.activeIndex).toBe(0);
	});
	it('an option toggle keeps the active position', () => {
		const s = makeState('a A a A\n');
		s.open();
		s.setQuery('a');
		s.next();
		expect(s.activeIndex).toBe(1);
		s.setOptions({ caseSensitive: true }); // 2 matches left; index 1 still valid
		expect(s.activeIndex).toBe(1);
	});
	it('sets error and clears matches on invalid regex', () => {
		const s = makeState('text\n');
		s.open();
		s.setOptions({ regex: true });
		s.setQuery('(');
		expect(s.error).not.toBeNull();
		expect(s.matches.length).toBe(0);
	});
	it('close clears matches and notifies onClose', () => {
		let closed = 0;
		const s = makeState('a a\n', () => closed++);
		s.open();
		s.setQuery('a');
		expect(s.matches.length).toBe(2);
		s.close();
		expect(s.isOpen).toBe(false);
		expect(s.matches.length).toBe(0);
		expect(closed).toBe(1);
	});
});
