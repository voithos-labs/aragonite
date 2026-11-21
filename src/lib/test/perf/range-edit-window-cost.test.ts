// @vitest-environment jsdom
// G4.342: a range edit reads the blocks its range reaches, never the document. It parses the same
// bytes and measures the same top-level blocks at 400 blocks as at 40. One cost is recorded, not
// A gesture after a write reads no text off the tree: its bytes come off the record the editor
// keeps across writes. A removal walks the tree's top-level list once, for its host, its commit and
// its undo snapshot, and a copy not at all, counted with dev checks off.
// Miss-analysis: the splice cost rows drove `commitSource` alone and the gate timed no range
// edit, so nothing counted what the range-edit core reads to make its answer.
// Miss-analysis, the walks: a walk never parses or measures, so the count rows above stayed green
// with the list read once by the range's host and again by the commit.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
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
import type { Draft } from '#lib/schema/drafts.js';
import { WRITE_ROUTES, type Mounted, type WriteRoute } from '#lib/test/harness/write-routes.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	resetEditorEnv();
	disablePerfInstruments();
	await destroyMountedEditors();
});

type RangeGesture = Pick<WriteRoute, 'name' | 'source' | 'setUp' | 'write' | 'asks'>;

/** A draft's commit is a byte splice too. Its offset is read off the fixture, since the editor's
 *  own text read here would be the read the row counts. */
let draft: Draft | undefined;
const DRAFT: RangeGesture = {
	name: 'a draft writing one letter',
	source: WRITE_ROUTES[0].source,
	async setUp(m, n) {
		const at = WRITE_ROUTES[0].source(n).indexOf('line 3');
		draft = m.instance.edit().replace({ from: at + 1, to: at + 1 }, 'X');
	},
	async write(m) {
		expect(await draft!.commit()).toMatchObject({ ok: true });
		await m.settle();
	},
	asks: () => ({ path: [3], offset: 0 })
};

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
	await gesture.write(m, n);
	await m.settle();
	const reads = {
		parsedBytes: perfSnapshot().parseBytes,
		topBlocksMeasured: perfSnapshot().topBlocksMeasured,
		textReads: perfSnapshot().textReads,
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
		textReads: [small.textReads, large.textReads]
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

// Miss-analysis: the row recorded one read of the whole text per gesture as its cost, so the first
// copy after a write in a long flat document read every block, four times a copy made again.
describe('G4.342 a gesture after a write reads no text off the tree', () => {
	it.each([...RANGE_EDITS, COPY, DRAFT])('$name', async (gesture) => {
		expect((await growthOf(gesture)).textReads).toEqual([0, 0]);
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

// Miss-analysis, the one walk: the row recorded three walks (the text, the plain list, the undo
// snapshot) as what a removal costs, so nothing held them to one.
describe('G4.342 a removal walks the top-level list once, and a copy not at all', () => {
	it.each([...REMOVALS, COPY])('$name', async (gesture) => {
		expect(REMOVALS).toHaveLength(3);
		const m: Mounted = mountEditor<EditorTestSurface>({ source: gesture.source(SMALL) });
		await m.settle();
		// A position first, so a record stands for the letter's write to move.
		m.instance.__test.byteOf([3], 0);
		// Then a letter, so the range's reads are the first of their content version.
		const first = surfaceAt(m, [0]);
		typeInto(first, first.textContent + 'x');
		await m.settle();
		// From the range's hold on, whose position reads take the same list.
		const callers = await wholeWalks(m, async () => {
			await gesture.setUp?.(m, SMALL);
			await gesture.write(m, SMALL);
			await m.settle();
		});
		expect(callers).toEqual(gesture === COPY ? [] : ['topsOf']);
	});
});
