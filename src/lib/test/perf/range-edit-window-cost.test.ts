// @vitest-environment jsdom
// G4.342: a range edit reads the blocks its range reaches, never the document. It parses the same
// bytes and measures the same top-level blocks at 400 blocks as at 40. One cost is recorded, not
// held yet: each route serializes the document once, and a fix that stops it reds that row. A
// removal also walks the tree's top-level list three times and no more, counted with dev checks off.
// Miss-analysis: the splice cost rows drove `commitSource` alone and the gate timed no range
// edit, so nothing counted what the range-edit core reads to make its answer.
// Miss-analysis, the walks: a walk never parses or measures, so the count rows above stayed green
// with the list read once by the range's host and again by the commit.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
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
	resetEditorEnv();
	disablePerfInstruments();
	await destroyMountedEditors();
});

type RangeGesture = Pick<WriteRoute, 'name' | 'source' | 'setUp' | 'write' | 'asks'>;

const RANGE_EDITS: RangeGesture[] = WRITE_ROUTES.filter((route) => route.rangeEdit);

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
		serializes: vi.mocked(serialize).mock.calls.length,
		spliceReads: perfSnapshot().spliceReads,
		spliceReadsKept: perfSnapshot().spliceReadsKept
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

describe('G4.342 a range edit reads the blocks its range reaches', () => {
	it.each([...RANGE_EDITS, COPY])('$name parses as many bytes at 400 blocks', async (gesture) => {
		expect((await growthOf(gesture)).parsedBytes).toBe(0);
	});

	it.each([...RANGE_EDITS, COPY])('$name measures as many blocks at 400', async (gesture) => {
		expect((await growthOf(gesture)).topBlocksMeasured).toBe(0);
	});

	it('a copy parses nothing and measures no block', async () => {
		expect(await readsOf(COPY, SMALL)).toMatchObject({ parsedBytes: 0, topBlocksMeasured: 0 });
	});
});

// Miss-analysis, the second read: the rows counted bytes parsed, which the commit's read of the
// same window added in a small window, so nothing saw the answer's window read twice.
describe('G4.342 a range edit reads its answer’s window once', () => {
	it.each(RANGE_EDITS)('$name: the commit takes the core’s reading', async (gesture) => {
		const { spliceReads, spliceReadsKept } = await readsOf(gesture, SMALL);
		expect(spliceReadsKept, `readings taken, beside ${spliceReads} made`).toBe(1);
	});

	it('a copy reads no window', async () => {
		expect(await readsOf(COPY, SMALL)).toMatchObject({ spliceReads: 0, spliceReadsKept: 0 });
	});
});

// Miss-analysis, the lines: G4.349's rows run the range-edit core alone, so nothing held that the
// editor's own reads around a range (a keystroke, a held range's paint) lay out no container line.
describe('G4.349 a keystroke and a held range in a giant quote lay out no container line', () => {
	it('typing a letter, then holding a range across two children', async () => {
		const quote = Array.from({ length: LARGE }, (_, i) => `> line ${i} with words\n>\n`).join('');
		const m: Mounted = mountEditor<EditorTestSurface>({ source: quote });
		await m.settle();
		enablePerfInstruments();
		resetPerfInstruments();
		const leaf = surfaceAt(m, [0, 3]);
		typeInto(leaf, leaf.textContent + 'x');
		await m.settle();
		await m.instance.setSelection({
			anchor: { path: [0, 3], offset: 2 },
			focus: { path: [0, 4], offset: 2 }
		});
		await m.settle();
		expect(perfSnapshot().linesLaid).toBe(0);
		await m.destroy();
	});
});

describe('G4.342 recorded: a range edit serializes the document', () => {
	it.each([...RANGE_EDITS, COPY])('$name, once', async (gesture) => {
		expect((await growthOf(gesture)).serializes).toEqual([1, 1]);
	});
});

/** The callers that walk the tree's top-level list to its end while `run` runs, with dev checks
 *  off as a production build has them: each such walk pays a proxy trap per block. */
async function wholeWalks(m: Mounted, run: () => Promise<void>): Promise<string[]> {
	const iterate = Array.prototype[Symbol.iterator];
	const callers: string[] = [];
	Array.prototype[Symbol.iterator] = function (this: unknown[]) {
		const steps = iterate.call(this);
		if (this !== m.instance.__test.getDocument().children) return steps;
		const caller = /at (?:\w+\.)?(\w+)/.exec(new Error().stack?.split('\n')[2] ?? '')?.[1];
		const next = steps.next.bind(steps);
		steps.next = () => {
			const step = next();
			if (step.done) callers.push(caller ?? 'unnamed');
			return step;
		};
		return steps;
	};
	configureEditorEnv({ isDev: false });
	try {
		await run();
	} finally {
		Array.prototype[Symbol.iterator] = iterate;
		resetEditorEnv();
	}
	return callers;
}

const REMOVALS = RANGE_EDITS.filter((route) => /^Backspace|^a cut/.test(route.name));

describe('G4.342 recorded: a removal walks the top-level list three times', () => {
	// The text it serializes, the plain list its host and its commit share, and its undo snapshot.
	it.each(REMOVALS)('$name', async (gesture) => {
		expect(REMOVALS).toHaveLength(3);
		const m: Mounted = mountEditor<EditorTestSurface>({ source: gesture.source(SMALL) });
		await m.settle();
		await gesture.setUp?.(m, SMALL);
		const callers = await wholeWalks(m, async () => {
			await gesture.write(m, SMALL);
			await m.settle();
		});
		expect(callers).toEqual(['concatChildren', 'topsOf', 'shareSnapshot']);
	});
});
