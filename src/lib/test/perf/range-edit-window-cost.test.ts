// @vitest-environment jsdom
// G4.342: a range edit reads the blocks its range reaches, never the document. Recorded, not held
// yet: every route through the range-edit core serializes the document once, and each that lays
// out its answer parses it whole and measures its every top-level block, so all three grow with
// the document. A fix that brings a cost down to the range's blocks reds that cost's rows here,
// which then flip to hold it the same at 400 blocks as at 40.
// Miss-analysis: the splice cost rows drove `commitSource` alone and the gate timed no range
// edit, so nothing counted what the range-edit core reads to make its answer.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchClipboardEvent, StubDataTransfer } from '#lib/test/harness/clipboard-events.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import { WRITE_ROUTES, type Mounted, type WriteRoute } from '#lib/test/harness/write-routes.js';

vi.mock('#lib/core/serializer.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/core/serializer.js')>();
	return { ...actual, serialize: vi.fn(actual.serialize) };
});

beforeAll(installLayoutStubs);
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

type RangeGesture = Pick<WriteRoute, 'name' | 'source' | 'setUp' | 'write' | 'asks'>;

const RANGE_EDITS: RangeGesture[] = WRITE_ROUTES.filter((route) => route.laysOutItsAnswer);

const SMALL = 40;
const LARGE = 400;

/** A copy writes nothing, so it is no write route; it reads the range through the same core. */
const COPY: RangeGesture = {
	name: 'a copy of a range the editor holds across blocks',
	source: RANGE_EDITS[0].source,
	async setUp(m) {
		await m.instance.setSelection({
			anchor: { path: [3], offset: 2 },
			focus: { path: [5], offset: 2 }
		});
		await m.settle();
	},
	async write(m) {
		const clipboard = new StubDataTransfer();
		dispatchClipboardEvent(surfaceAt(m, [3]), 'copy', clipboard);
		await m.settle();
		expect(clipboard.getData('text/plain'), 'the copy wrote nothing').not.toBe('');
	},
	asks: () => ({ path: [3], offset: 0 })
};

/** What `gesture` reads in a document of `n` blocks, made as a range edit after typing is: a host
 *  asked for the text, then a letter was typed, so no text of this version stands. */
async function readsOf(gesture: RangeGesture, n: number) {
	const m: Mounted = mountEditor<EditorTestSurface>({ source: gesture.source(n) });
	await m.settle();
	m.source();
	const first = surfaceAt(m, [0]);
	typeInto(first, first.textContent + 'x');
	await m.settle();
	await gesture.setUp?.(m, n);
	// Asked ahead of the gesture, so the blocks counted below are its own and not a first read's.
	const { path, offset } = gesture.asks(n);
	m.instance.__test.byteOf(path, offset);
	// Armed, so the dev checks that parse and serialize the document stay out of the counts.
	enablePerfInstruments();
	resetPerfInstruments();
	vi.mocked(serialize).mockClear();
	await gesture.write(m, n);
	await m.settle();
	const reads = {
		parsedBytes: perfSnapshot().parseBytes,
		topBlocksMeasured: perfSnapshot().topBlocksMeasured,
		serializes: vi.mocked(serialize).mock.calls.length
	};
	await m.destroy();
	return reads;
}

/** How much more `gesture` reads at 400 blocks than at 40. */
async function growthOf(gesture: RangeGesture) {
	const small = await readsOf(gesture, SMALL);
	const large = await readsOf(gesture, LARGE);
	return {
		parsedBytes: large.parsedBytes - small.parsedBytes,
		topBlocksMeasured: large.topBlocksMeasured - small.topBlocksMeasured,
		serializes: [small.serializes, large.serializes]
	};
}

describe('G4.342 recorded: a range edit reads its whole document', () => {
	it.each(RANGE_EDITS)('$name parses its whole answer, once', async (gesture) => {
		const grown = gesture.source(LARGE).length - gesture.source(SMALL).length;
		expect((await growthOf(gesture)).parsedBytes).toBe(grown);
	});

	it.each(RANGE_EDITS)('$name measures every top-level block of its answer', async (gesture) => {
		expect((await growthOf(gesture)).topBlocksMeasured).toBe(LARGE - SMALL);
	});

	it.each([...RANGE_EDITS, COPY])('$name serializes the document, once', async (gesture) => {
		expect((await growthOf(gesture)).serializes).toEqual([1, 1]);
	});
});

describe('G4.342 a copy reads its range off the tree the editor holds', () => {
	it('parses nothing and measures no block, at 400 blocks as at 40', async () => {
		expect(await readsOf(COPY, SMALL)).toMatchObject({ parsedBytes: 0, topBlocksMeasured: 0 });
		expect(await readsOf(COPY, LARGE)).toMatchObject({ parsedBytes: 0, topBlocksMeasured: 0 });
	});
});
