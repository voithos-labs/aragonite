import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { createDecorationEngine } from '../../decorations/decoration-state.svelte';
import { createSearchState } from '../../search/search-state.svelte';
import {
	createRegexExecutor,
	type RegexExecutor,
	type RegexScanOutcome,
	type RegexScanRequest
} from '../../search/regex-executor';

// Regex scans leave the main thread, so their results land after the call that
// asked for them. These pin what the find bar does in that window.

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** An executor that settles only when the test says so, so the window between
 *  kickoff and landing is inspectable. */
function makeHeldExecutor() {
	const held: { request: RegexScanRequest; settle: (o: RegexScanOutcome) => void }[] = [];
	const executor: RegexExecutor = {
		scan: (request) => new Promise((resolve) => held.push({ request, settle: resolve })),
		release: () => {}
	};
	return { executor, held };
}

function makeState(source: string, regexExecutor?: RegexExecutor) {
	const doc = parse(source);
	const state = createSearchState({
		getDoc: () => doc,
		getDocumentGeneration: () => 0,
		decorations: createDecorationEngine({ getDoc: () => doc }),
		replace: { replaceOne: async () => 0, replaceAll: async () => 0 },
		reveal: async () => null,
		regexExecutor,
		onClose: () => {}
	});
	state.open();
	state.setOptions({ regex: true });
	return { state };
}

describe('SearchState — off-thread regex scans', () => {
	it('publishes matches when the scan lands, not when the query is set', async () => {
		// The real executor on its synchronous fallback: still a promise, so the
		// find bar sees the same two-phase shape it sees in a browser.
		const { state } = makeState('cat cat\n\ncat\n', createRegexExecutor());
		state.setQuery('c.t');
		expect(state.isScanning).toBe(true);
		expect(state.matches).toHaveLength(0);

		await flush();
		expect(state.isScanning).toBe(false);
		expect(state.matches).toHaveLength(3);
		expect(state.activeIndex).toBe(0);
	});

	it('literal search stays synchronous — no scanning window at all', () => {
		const { state } = makeState('cat cat\n');
		state.setOptions({ regex: false });
		state.setQuery('cat');
		expect(state.isScanning).toBe(false);
		expect(state.matches).toHaveLength(2);
	});

	it('drops a stale scan: only the newest query reaches the matches', async () => {
		const { executor, held } = makeHeldExecutor();
		const { state } = makeState('cat cat\n\ndog\n', executor);
		state.setQuery('c.t');
		state.setQuery('d.g');
		expect(held).toHaveLength(2);

		// The superseded scan settles LAST, so a missing epoch check would let it win.
		held[1].settle({
			ok: true,
			epoch: held[1].request.epoch,
			ranges: [[], [{ start: 0, end: 3 }]]
		});
		held[0].settle({
			ok: true,
			epoch: held[0].request.epoch,
			ranges: [
				[
					{ start: 0, end: 3 },
					{ start: 4, end: 7 }
				],
				[]
			]
		});
		await flush();

		expect(state.matches).toHaveLength(1);
		expect(state.matches[0].path).toEqual([1]);
	});

	it('a scan settling after close writes nothing onto the closed bar', async () => {
		const { executor, held } = makeHeldExecutor();
		const { state } = makeState('cat cat\n', executor);
		state.setQuery('c.t');
		state.close();

		held[0].settle({
			ok: true,
			epoch: held[0].request.epoch,
			ranges: [[{ start: 0, end: 3 }]]
		});
		await flush();

		expect(state.isOpen).toBe(false);
		expect(state.matches).toHaveLength(0);
		expect(state.isScanning).toBe(false);
	});

	it('a deadline overrun surfaces the too-slow state and paints nothing', async () => {
		const { executor, held } = makeHeldExecutor();
		const { state } = makeState('cat cat\n', executor);
		state.setQuery('(a+)+$');
		held[0].settle({ ok: false, epoch: held[0].request.epoch, reason: 'timeout' });
		await flush();

		expect(state.error).toBe('Regex too slow');
		expect(state.matches).toHaveLength(0);
		expect(state.isScanning).toBe(false);
	});

	it('a failed scan is contained as a state, never a rejection', async () => {
		// A worker that errors or dies routes to the same handled path as a timeout.
		const { executor, held } = makeHeldExecutor();
		const { state } = makeState('cat\n', executor);
		state.setQuery('c.t');
		held[0].settle({ ok: false, epoch: held[0].request.epoch, reason: 'error' });
		await flush();

		expect(state.error).toBe('Regex search failed');
		expect(state.matches).toHaveLength(0);
	});

	it('the too-slow state clears on the next query', async () => {
		const { executor, held } = makeHeldExecutor();
		const { state } = makeState('cat cat\n', executor);
		state.setQuery('(a+)+$');
		held[0].settle({ ok: false, epoch: held[0].request.epoch, reason: 'timeout' });
		await flush();
		expect(state.error).toBe('Regex too slow');

		state.setQuery('c.t');
		expect(state.error).toBeNull();
		held[1].settle({ ok: true, epoch: held[1].request.epoch, ranges: [[{ start: 0, end: 3 }]] });
		await flush();
		expect(state.matches).toHaveLength(1);
	});

	it('replaceAll waits for the pending scan instead of reading an empty set', async () => {
		// Without the await, replaceAll's `if (!matches.length) return` fires on the
		// scan window and the click silently does nothing.
		const doc = parse('cat cat\n');
		let replacedWith: number | null = null;
		const state = createSearchState({
			getDoc: () => doc,
			getDocumentGeneration: () => 0,
			decorations: createDecorationEngine({ getDoc: () => doc }),
			replace: {
				replaceOne: async () => 0,
				replaceAll: async (ms) => {
					replacedWith = ms.length;
					return ms.length;
				}
			},
			reveal: async () => null,
			regexExecutor: createRegexExecutor(),
			onClose: () => {}
		});
		state.open();
		state.setOptions({ regex: true });
		state.setQuery('c.t');
		expect(state.matches).toHaveLength(0); // still scanning

		await state.replaceAll();
		expect(replacedWith).toBe(2);
	});
});
