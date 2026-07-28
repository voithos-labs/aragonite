import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { createDecorationEngine } from '../../decorations/decoration-state.svelte';
import { createSearchState } from '../../search/search-state.svelte';

const stubReplace = { replaceOne: async () => 0, replaceAll: async () => 0 };

function makeState(
	source: string,
	onClose: () => void = () => {},
	replace: typeof stubReplace = stubReplace
) {
	const doc = parse(source);
	return createSearchState({
		getDoc: () => doc,
		getDocumentGeneration: () => 0,
		decorations: createDecorationEngine({ getDoc: () => doc }),
		replace,
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
	it('replacedCount reports the replace path’s real count, not the match count', async () => {
		// The replace path may skip matches (childless opaque containers), so the
		// count comes from its return value — 2 matches here, only 1 replaced.
		const s = makeState('cat cat\n', () => {}, {
			replaceOne: async () => 0,
			replaceAll: async () => 1
		});
		s.open();
		s.setQuery('cat');
		expect(s.matches.length).toBe(2);
		await s.replaceAll();
		expect(s.replacedCount).toBe(1);
		await s.replaceCurrent();
		expect(s.replacedCount).toBe(0);
	});
	it('matchesForPath returns the leaf’s matches with their flat indexes', () => {
		const s = makeState('cat\n\ncat cat\n');
		s.open();
		s.setQuery('cat');
		expect(s.matchesForPath([1]).map((m) => m.index)).toEqual([1, 2]);
		expect(s.matchesForPath([9])).toEqual([]);
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
	it('reopening with an unchanged query re-publishes the matches', () => {
		// close() clears matches; the cap-1 scan memo must drop with them, or reopen
		// (same editEpoch + query) hits the primed key, skips the rescan, and serves
		// the cleared empty set. addSource re-runs provide synchronously, so the
		// reopened matches are observable right here.
		const s = makeState('a a\n');
		s.open();
		s.setQuery('a');
		expect(s.matches.length).toBe(2);
		s.close();
		expect(s.matches.length).toBe(0);
		s.open();
		expect(s.matches.length).toBe(2);
	});
});
