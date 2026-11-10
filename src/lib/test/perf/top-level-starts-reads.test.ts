// @vitest-environment jsdom
// G4.340: a listener that asks where the caret is after every write reads the top-level blocks the
// write changed, the same number in a document four times as long. A route that names no blocks is
// declared `whole` and reads every block once; making it exact flips its row here.
// Miss-analysis: the keystroke cost rows drove the commit alone, so nothing priced the position
// read a plugin makes after it, which summed every top-level block once per content version.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { WRITE_ROUTES, type WriteRoute } from '#lib/test/harness/write-routes.js';

beforeAll(installLayoutStubs);
beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

const N = 20;

/** Top-level blocks measured over `route`'s write in a document of `n`, with a listener asking a
 *  position's byte on every edit and once more when the write has settled. */
async function blocksMeasured(route: WriteRoute, n: number): Promise<number> {
	const m = mountEditor<EditorTestSurface>({ source: route.source(n) });
	await m.settle();
	await route.setUp?.(m, n);
	const { path, offset } = route.asks(n);
	const ask = () => m.instance.__test.byteOf(path, offset);
	// Asked ahead of the write, so the count below is the write's and not the document's first read.
	ask();
	const off = m.instance.getEvents().on('edit', ask);
	const before = perfSnapshot().topBlocksMeasured;
	const source = m.source();
	await route.write(m, n);
	expect(m.source(), 'the route wrote nothing').not.toBe(source);
	expect(ask(), 'the listener asked a position the write left no text at').not.toBeNull();
	const measured = perfSnapshot().topBlocksMeasured - before;
	off();
	await m.destroy();
	return measured;
}

describe('G4.340 a position read after a write measures the blocks the write changed', () => {
	it.each(WRITE_ROUTES.filter((route) => route.announces === 'exact'))(
		'$name: as many at 80 blocks as at 20',
		async (route) => {
			expect(await blocksMeasured(route, 4 * N)).toBe(await blocksMeasured(route, N));
		}
	);

	it.each(WRITE_ROUTES.filter((route) => route.announces === 'whole'))(
		'$name names no blocks: every block is measured once',
		async (route) => {
			// One fewer than the document started with, where the write joined two blocks.
			expect(await blocksMeasured(route, N)).toBeGreaterThanOrEqual(N - 1);
			expect(await blocksMeasured(route, 4 * N)).toBeGreaterThanOrEqual(4 * N - 1);
		}
	);
});
