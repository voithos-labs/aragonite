import { describe, it, expect } from 'vitest';
import { makeSearchHarness, type ReplaceStub } from './harness';

function makeHarness(source: string, replace?: ReplaceStub) {
	let scans = 0;
	const h = makeSearchHarness(source, {
		replace,
		// rescan reads the generation exactly once at its top, and scans the doc the
		// registry hands `provide` rather than this getter — so this read counts rescans.
		getDocumentGeneration: () => {
			scans++;
			return 0;
		}
	});
	return { ...h, scanCount: () => scans };
}

describe('search as decoration source', () => {
	it('open registers editor:search; close disposes it (zero-cost when closed)', () => {
		const { engine, state } = makeHarness('cat\n');
		expect(engine.sourceCount).toBe(0);
		state.open();
		expect(engine.sourceCount).toBe(1);
		state.close();
		expect(engine.sourceCount).toBe(0);
	});

	it('setQuery publishes marks synchronously, active class on the active match', () => {
		const { engine, state } = makeHarness('cat cat\n');
		state.open();
		state.setQuery('cat');
		const classes = engine.marksForPath([0]).map((m) => m.dec.class);
		expect(classes).toEqual(['match-overlay match-overlay-active', 'match-overlay']);
	});

	it('navigation remaps classes without rescanning — memo hit', () => {
		const { engine, state, scanCount } = makeHarness('cat cat\n');
		state.open();
		state.setQuery('cat');
		const scans = scanCount();
		state.next();
		expect(scanCount()).toBe(scans); // epoch + query + options unchanged
		const classes = engine.marksForPath([0]).map((m) => m.dec.class);
		expect(classes).toEqual(['match-overlay', 'match-overlay match-overlay-active']);
	});

	it('an edit-epoch bump forces a rescan — memo miss', () => {
		const { engine, state, scanCount } = makeHarness('cat cat\n');
		state.open();
		state.setQuery('cat');
		const scans = scanCount();
		engine.notifyEdit(); // what the editor's edit subscriber calls post-commit
		expect(scanCount()).toBe(scans + 1);
	});

	it('in-place typing (children identity unchanged) reaches the next scan', () => {
		// Routine typing mutates the leaf in place — doc.children identity never
		// changes — so an identity-keyed memo would serve stale matches here.
		const { doc, engine, state } = makeHarness('cat\n');
		state.open();
		state.setQuery('cat');
		expect(state.matches).toHaveLength(1);
		doc.children[0].raw = 'cat cat\n';
		engine.notifyEdit();
		expect(state.matches).toHaveLength(2);
		expect(engine.marksForPath([0])).toHaveLength(2);
	});

	// Replace mutates the doc while the memo key (epoch + query + options) stays put
	// until the deferred edit notification, so an invalidate-only refresh serves the
	// pre-replace matches from a memo hit. Rescan must precede invalidate.
	it('replaceCurrent refreshes matches synchronously on the bar-open path', async () => {
		const { doc, state } = makeHarness('cat cat\n', {
			replaceOne: async (_m, text) => {
				doc.children[0].raw = doc.children[0].raw.replace('cat', text);
				return 1;
			},
			replaceAll: async () => 0
		});
		state.open();
		state.setReplacement('dog');
		state.setQuery('cat');
		expect(state.matches).toHaveLength(2);
		await state.replaceCurrent();
		expect(state.matches).toHaveLength(1);
	});

	it('replaceAll refreshes matches synchronously on the bar-open path', async () => {
		const { doc, state } = makeHarness('cat cat\n', {
			replaceOne: async () => 0,
			replaceAll: async (_ms, text) => {
				doc.children[0].raw = doc.children[0].raw.replaceAll('cat', text);
				return 2;
			}
		});
		state.open();
		state.setReplacement('dog');
		state.setQuery('cat');
		expect(state.matches).toHaveLength(2);
		await state.replaceAll();
		expect(state.matches).toHaveLength(0);
	});

	it('close clears the published marks', () => {
		const { engine, state } = makeHarness('cat\n');
		state.open();
		state.setQuery('cat');
		expect(engine.marksForPath([0])).toHaveLength(1);
		state.close();
		expect(engine.marksForPath([0])).toHaveLength(0);
	});

	it('reopen after close re-registers without a duplicate-name throw', () => {
		const { engine, state } = makeHarness('cat\n');
		state.open();
		state.close();
		expect(() => state.open()).not.toThrow();
		expect(engine.sourceCount).toBe(1);
	});

	it('a second open while already open is a no-op, not a duplicate source', () => {
		const { engine, state } = makeHarness('cat\n');
		state.open();
		expect(() => state.open()).not.toThrow(); // Ctrl+H over an open find bar
		expect(engine.sourceCount).toBe(1);
	});
});
