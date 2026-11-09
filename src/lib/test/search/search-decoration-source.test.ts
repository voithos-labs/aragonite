import { describe, it, expect } from 'vitest';
import { makeSearchHarness, type ReplaceStub } from './harness';
import { paintAt } from '../decorations/fixtures/decorations';

function makeHarness(source: string, replace?: ReplaceStub) {
	let scans = 0;
	const h = makeSearchHarness(source, {
		replace,
		// The rescan reads the generation exactly once at its top, so this read counts rescans.
		getDocumentGeneration: () => {
			scans++;
			return 0;
		}
	});
	return { ...h, scanCount: () => scans };
}

describe('search highlights', () => {
	it('are read only while the bar is open', () => {
		const { state } = makeHarness('cat\n');
		expect(state.highlights).toBeNull();
		state.open();
		expect(state.highlights?.name).toBe('editor:search');
		state.close();
		expect(state.highlights).toBeNull();
	});

	it('setQuery publishes marks synchronously, active class on the active match', () => {
		const { engine, state } = makeHarness('cat cat\n');
		state.open();
		state.setQuery('cat');
		const classes = paintAt(engine, [0]).marks.map((m) => m.dec.class);
		expect(classes).toEqual(['match-overlay match-overlay-active', 'match-overlay']);
	});

	it('navigation remaps classes without rescanning: memo hit', () => {
		const { engine, state, scanCount } = makeHarness('cat cat\n');
		state.open();
		state.setQuery('cat');
		const scans = scanCount();
		state.next();
		expect(scanCount()).toBe(scans); // epoch + query + options unchanged
		const classes = paintAt(engine, [0]).marks.map((m) => m.dec.class);
		expect(classes).toEqual(['match-overlay', 'match-overlay match-overlay-active']);
	});

	it('a document change forces a rescan: memo miss', () => {
		const { state, scanCount } = makeHarness('cat cat\n');
		state.open();
		state.setQuery('cat');
		const scans = scanCount();
		state.documentChanged(); // what the editor calls once an edit's flush is done
		expect(scanCount()).toBe(scans + 1);
	});

	it('a document change while the bar is closed scans nothing', () => {
		const { state, scanCount } = makeHarness('cat cat\n');
		const scans = scanCount();
		state.documentChanged();
		expect(scanCount()).toBe(scans);
	});

	it('in-place typing (children identity unchanged) reaches the next scan', () => {
		// Routine typing mutates the leaf in place and `doc.children` never changes identity, so a
		// memo keyed on identity would serve stale matches here.
		const { doc, engine, state } = makeHarness('cat\n');
		state.open();
		state.setQuery('cat');
		expect(state.matches).toHaveLength(1);
		doc.children[0].raw = 'cat cat\n';
		state.documentChanged();
		expect(state.matches).toHaveLength(2);
		expect(paintAt(engine, [0]).marks).toHaveLength(2);
	});

	// Replace mutates the document before the deferred edit notification changes the memo key, so
	// it rescans itself or the bar serves the matches from before it.
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

	it('a rescan keeps the marks of a block whose matches came out the same', () => {
		const { doc, engine, state } = makeHarness('cat\n\ncat\n');
		state.open();
		state.setQuery('cat');
		const second = () => engine.paintOf(doc.children[1], [1]).marks;
		const before = second();
		doc.children[0].raw = 'cat cat\n';
		state.documentChanged();
		expect(state.matches).toHaveLength(3);
		expect(second()).toBe(before);
	});

	it('close clears the published marks', () => {
		const { engine, state } = makeHarness('cat\n');
		state.open();
		state.setQuery('cat');
		expect(paintAt(engine, [0]).marks).toHaveLength(1);
		state.close();
		expect(paintAt(engine, [0]).marks).toHaveLength(0);
	});

	it('reopen after close paints the query again', () => {
		const { engine, state } = makeHarness('cat\n');
		state.open();
		state.setQuery('cat');
		state.close();
		state.open();
		expect(paintAt(engine, [0]).marks).toHaveLength(1);
	});

	it('a second open while already open scans nothing', () => {
		const { state, scanCount } = makeHarness('cat\n');
		state.open();
		state.setQuery('cat');
		const scans = scanCount();
		state.open(); // Ctrl+H over an open find bar
		expect(scanCount()).toBe(scans);
	});
});
