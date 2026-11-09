/**
 * Shared keystroke-latency measurement for the perf specs. The reporting harness
 * (`typing-latency`) and the gate (`perf-gate`) measure the same way and must not drift apart,
 * so "type into a loaded fixture and time each keystroke" is defined once, here.
 */

import { type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EditorPage } from '../../editor-page';
import type { PresentationMode } from '../../../presentation-mode';
import {
	generateFixture,
	generateDeepNested,
	deepNestedLeafPath,
	type FixtureShape
} from '../../../test/perf/fixtures/generate';

const LOAD_TIMEOUT_MS = 480_000;
const KEYSTROKE_TIMEOUT_MS = 60_000;

// A container-first fixture gets a paragraph in front, since block 0 is always mounted:
// `focusBlockEnd(0)` would aim at an unmounted last child.
const NEEDS_PROSE_TARGET: ReadonlySet<FixtureShape> = new Set([
	'nested-containers',
	'table-heavy',
	'giant-single-list',
	'giant-single-blockquote',
	'giant-single-table'
]);
// The trailing newline plus the separator leaves a blank line after the paragraph, so it
// parses as a block of its own in front of the container.
const PROSE_TARGET = 'perf cursor target\n';

export interface LatencyMeasurement {
	loadMs: number;
	samples: number[];
	p50Ms: number;
	p95Ms: number;
}

export interface DeepTypingMeasurement extends LatencyMeasurement {
	// Measured over a short counted burst, separate from the timed loop.
	rendersPerKeystroke: number;
	rebuildDepths: Record<number, number>;
}

// `getSource()` serializes the whole document on every poll, which at 10MB costs more than the
// latency measured; summing the raw lengths sees the same commit without building the string.
export function docLengthInPage(): number {
	const doc = (window as any).__test.getDocument();
	let length = doc.prefix.length + doc.suffix.length;
	for (const child of doc.children) length += child.leadingTrivia.length + child.raw.length;
	return length;
}

export async function waitForDocLength(page: Page, min: number, timeout: number): Promise<void> {
	await page.waitForFunction(
		({ fnSrc, min }) => (new Function(`return (${fnSrc})();`)() as number) >= min,
		{ fnSrc: docLengthInPage.toString(), min },
		{ timeout, polling: 16 }
	);
}

// Sees the same commit as `docLengthInPage` at constant cost, so rows with many blocks do not add
// the harness's own summing cost (`docs/design/performance.md`).
export async function waitForBlock0Len(page: Page, min: number, timeout: number): Promise<void> {
	await page.waitForFunction(
		(min) => {
			const c = (window as any).__test.getDocument().children[0];
			return c ? c.leadingTrivia.length + c.raw.length >= min : false;
		},
		min,
		{ timeout, polling: 16 }
	);
}

/** How every perf row reports, defined once: a console line the run log is read for, and a
 *  JSON file under `perf-results/`. */
export function writePerfResult(consolePrefix: string, fileStem: string, result: object): void {
	const line = JSON.stringify(result);
	console.log(`${consolePrefix} ${line}`);
	mkdirSync('perf-results', { recursive: true });
	writeFileSync(`perf-results/${fileStem}.json`, line + '\n');
}

export function percentileMs(samples: number[], p: number): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export interface DocumentTypingMeasurement extends LatencyMeasurement {
	/** Widgets matching the row's `requireWidget`, counted on the loaded document. */
	mountedWidgets?: number;
}

// ── Measurement steps ───────────────────────────────────────────────────────
// Every measure function below puts these together in its own order; the sequence of awaits is
// the measurement, so a step moves or appears only alongside a fresh baseline.

async function loadFixture(page: Page, editor: EditorPage, fixture: string): Promise<number> {
	const loadStart = performance.now();
	await page.evaluate((content) => (window as any).__test.setSource(content), fixture);
	// serialize() may trim trailing whitespace, so wait on the trimmed length.
	await waitForDocLength(page, fixture.replace(/\s+$/, '').length, LOAD_TIMEOUT_MS);
	await editor.waitForRenderFlush();
	return performance.now() - loadStart;
}

/** A keystroke into an unmounted block lands on `<body>`, so the wait would time out instead of
 *  reporting. */
async function assertMounted(page: Page, path: number[], what: string): Promise<void> {
	const mounted = await page.evaluate(
		(path) => (window as any).__test.isBlockMounted(path) as boolean,
		path
	);
	if (!mounted) {
		throw new Error(`${what} ${JSON.stringify(path)} is not mounted, windowing left it off-window`);
	}
}

function leafRawLength(page: Page, path: number[]): Promise<number> {
	return page.evaluate((path) => {
		let node = (window as any).__test.getDocument();
		for (const index of path) node = node.children[index];
		return node.raw.length as number;
	}, path);
}

async function block0Length(page: Page): Promise<number> {
	return page.evaluate(() => {
		const c = (window as any).__test.getDocument().children[0];
		return c.leadingTrivia.length + c.raw.length;
	});
}

/** One `x` per sample, each timed to block 0 growing by one character, which it must whichever
 *  child took the keystroke, since the rebuild carries it up to the root. */
async function sampleKeystrokes(
	page: Page,
	editor: EditorPage,
	base0: number,
	keystrokes: number
): Promise<number[]> {
	const samples: number[] = [];
	for (let i = 1; i <= keystrokes; i++) {
		const keyStart = performance.now();
		await editor.typeSlowly('x');
		await waitForBlock0Len(page, base0 + i, KEYSTROKE_TIMEOUT_MS);
		samples.push(performance.now() - keyStart);
	}
	return samples;
}

/**
 * Types at the end of block 0 on a page the caller navigated to, so a plugins-route row and an
 * editor-route row measure the same way. `requireWidget` fails a row whose plugin is not running.
 */
export async function measureTypingIntoDocument(
	page: Page,
	editor: EditorPage,
	fixture: string,
	keystrokes: number,
	requireWidget?: string
): Promise<DocumentTypingMeasurement> {
	const loadMs = await loadFixture(page, editor, fixture);

	// Counted before typing: the mounted widgets are what the per-keystroke work runs over, so
	// a row that measured none measured something else entirely.
	let mountedWidgets: number | undefined;
	if (requireWidget !== undefined) {
		mountedWidgets = await page.locator(requireWidget).count();
		if (mountedWidgets === 0)
			throw new Error(
				`no ${requireWidget} mounted: the inline syntax handler is not live on this route`
			);
	}

	await editor.focusBlockEnd(0);
	await assertMounted(page, [0], 'perf target block');
	const base0 = await block0Length(page);
	const samples = await sampleKeystrokes(page, editor, base0, keystrokes);

	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95),
		mountedWidgets
	};
}

/**
 * `mode` is the presentation mode the route starts in, a variable rather than a second
 * measurement, so a mode that made a keystroke cost more shows in the same samples.
 */
export async function measureTypingLatency(
	page: Page,
	editor: EditorPage,
	shape: FixtureShape,
	bytes: number,
	keystrokes: number,
	mode: PresentationMode = 'source'
): Promise<LatencyMeasurement> {
	await editor.goto(mode === 'source' ? '' : `?presentationMode=${mode}`);
	const fixture = NEEDS_PROSE_TARGET.has(shape)
		? PROSE_TARGET + '\n' + generateFixture(shape, bytes)
		: generateFixture(shape, bytes);
	return measureTypingIntoDocument(page, editor, fixture, keystrokes);
}

/**
 * The inside-a-container companion to {@link measureTypingLatency}. The caret sits on the first
 * child, always mounted, whose keystroke moves the container's opening line.
 */
export async function measureContainerInteriorTyping(
	page: Page,
	editor: EditorPage,
	shape: FixtureShape,
	leafPath: number[],
	bytes: number,
	keystrokes: number
): Promise<LatencyMeasurement> {
	await editor.goto();
	const fixture = generateFixture(shape, bytes);

	const loadMs = await loadFixture(page, editor, fixture);
	await assertMounted(page, leafPath, 'container interior');

	// Asking for an offset past the child's own length falls back to the end in
	// focusBlockAtPath, so the caret sits at that child's end whatever it contains.
	await editor.focusBlockAtPath(leafPath, Number.MAX_SAFE_INTEGER);
	const base0 = await block0Length(page);
	const leafBefore = await leafRawLength(page, leafPath);
	const samples = await sampleKeystrokes(page, editor, base0, keystrokes);

	// Block 0 grows wherever in the container a key lands, so only the target leaf proves the row
	// timed typing there.
	const typed = (await leafRawLength(page, leafPath)) - leafBefore;
	if (samples.length === 0 || typed !== keystrokes) {
		throw new Error(
			`container interior ${JSON.stringify(leafPath)} took ${typed} of ${keystrokes} keystrokes`
		);
	}
	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95)
	};
}

/**
 * The deep-nesting companion to {@link measureTypingLatency}: the deepest child pays for
 * rebuilding the raw text of every block above it, which the rebuild carries up to block 0.
 */
export async function measureDeepNestedTyping(
	page: Page,
	editor: EditorPage,
	depth: number,
	bytesPerLevel: number,
	keystrokes: number
): Promise<DeepTypingMeasurement> {
	await editor.goto();
	const fixture = generateDeepNested(depth, bytesPerLevel);

	const loadMs = await loadFixture(page, editor, fixture);

	const leafPath = deepNestedLeafPath(depth);
	await assertMounted(page, leafPath, 'deep leaf');

	// Past the end, so focusBlockAtPath falls back to the end of that child, which is the target.
	await editor.focusBlockAtPath(leafPath, bytesPerLevel);
	const base0 = await block0Length(page);
	const samples = await sampleKeystrokes(page, editor, base0, keystrokes);

	// Counted but not timed: the render count tells rebuilding apart from a cascade of renders, and
	// counting would distort the timings above.
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	const burst = 5;
	const burstBase = base0 + keystrokes;
	for (let i = 1; i <= burst; i++) {
		await editor.typeSlowly('x');
		await waitForBlock0Len(page, burstBase + i, KEYSTROKE_TIMEOUT_MS);
	}
	const snap = await page.evaluate(() => (window as any).__test.perf.snapshot());

	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95),
		rendersPerKeystroke: snap.blockRenderCount / burst,
		rebuildDepths: snap.rebuildDepths
	};
}

export interface ArrivalMeasurement {
	loadMs: number;
	fromAbove: number[];
	fromBelow: number[];
}

/** Whether the caret's focus sits in the top-level block at `index`. */
async function waitForCaretInBlock(page: Page, index: number): Promise<void> {
	await page.waitForFunction(
		(i) => (window as any).__test.getSelection()?.focus.path[0] === i,
		index,
		{ timeout: KEYSTROKE_TIMEOUT_MS }
	);
}

/**
 * Times a vertical arrow into block 1 from block 0 above and block 2 below. The caret goes back by
 * placement, since an arrow from a multi-line target can land on a line inside it.
 */
export async function measureVerticalArrival(
	page: Page,
	editor: EditorPage,
	fixture: string,
	arrivals: number
): Promise<ArrivalMeasurement> {
	const loadMs = await loadFixture(page, editor, fixture);
	await assertMounted(page, [1], 'arrival target block');

	const timeArrivals = async (
		from: number,
		toward: string,
		placeBack: () => Promise<void>
	): Promise<number[]> => {
		const samples: number[] = [];
		for (let i = 0; i < arrivals; i++) {
			await placeBack();
			await waitForCaretInBlock(page, from);
			const keyStart = performance.now();
			await page.keyboard.press(toward);
			await waitForCaretInBlock(page, 1);
			samples.push(performance.now() - keyStart);
		}
		return samples;
	};

	const fromAbove = await timeArrivals(0, 'ArrowDown', () => editor.focusBlockEnd(0));
	const fromBelow = await timeArrivals(2, 'ArrowUp', () => editor.focusBlockStart(2));
	return { loadMs, fromAbove, fromBelow };
}

/** Whether the document has exactly `count` top-level blocks: an O(1) read, whatever its size. */
async function waitForTopLevelCount(page: Page, count: number): Promise<void> {
	await page.waitForFunction(
		(n) => (window as any).__test.getDocument().children.length === n,
		count,
		{ timeout: KEYSTROKE_TIMEOUT_MS, polling: 16 }
	);
}

/**
 * Enter at the end of block 0 splits off an empty block and Backspace merges it back, alternating;
 * each rebuilds the whole windowing model, which a typed character never does.
 */
export async function measureStructuralRebuild(
	page: Page,
	editor: EditorPage,
	shape: FixtureShape,
	bytes: number,
	edits: number
): Promise<LatencyMeasurement> {
	await editor.goto();
	const loadMs = await loadFixture(page, editor, generateFixture(shape, bytes));
	await editor.focusBlockEnd(0);
	await assertMounted(page, [0], 'structural edit target block');
	const baseCount = await page.evaluate(
		() => (window as any).__test.getDocument().children.length as number
	);

	const samples: number[] = [];
	for (let i = 0; i < edits; i++) {
		const isSplit = i % 2 === 0;
		const editStart = performance.now();
		await page.keyboard.press(isSplit ? 'Enter' : 'Backspace');
		await waitForTopLevelCount(page, isSplit ? baseCount + 1 : baseCount);
		samples.push(performance.now() - editStart);
	}

	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95)
	};
}

/** Copies of a range across `items` items of a giant list, from item `item` down, each timed from
 *  the copy command to its return: the copy writes before anything awaits. */
export async function measureListCopy(
	page: Page,
	editor: EditorPage,
	bytes: number,
	item: number,
	items: number,
	copies: number
): Promise<LatencyMeasurement> {
	await editor.goto();
	const loadMs = await loadFixture(page, editor, generateFixture('giant-single-list', bytes));
	const leaf = [0, item, 0];
	await assertMounted(page, leaf, 'list item');
	await editor.focusBlockAtPath(leaf, 0);
	for (let i = 0; i < items; i++) await page.keyboard.press('Shift+ArrowDown');
	await editor.waitForCrossBlock(true);
	const samples: number[] = [];
	for (let i = 0; i < copies; i++) {
		samples.push(
			await page.evaluate(() => {
				let written = '';
				const read = (e: ClipboardEvent) =>
					(written = e.clipboardData?.getData('text/plain') ?? '');
				window.addEventListener('copy', read, { once: true });
				const start = performance.now();
				document.execCommand('copy');
				const ms = performance.now() - start;
				// A copy that wrote nothing would time as fast as one that did.
				if (written === '') throw new Error('the copy wrote nothing');
				return ms;
			})
		);
	}
	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95)
	};
}

// ── Edits inside a giant container ──────────────────────────────────────────

export type GiantContainer = 'giant-single-list' | 'giant-single-blockquote' | 'giant-single-table';

/** Where child `child` of each giant container fixture sits: the text block a caret takes in it,
 *  and the source line its text starts on. */
const CONTAINER_CHILD: Record<
	GiantContainer,
	{ leaf: (child: number) => number[]; line: (child: number) => number }
> = {
	'giant-single-list': { leaf: (c) => [0, c, 0], line: (c) => c },
	'giant-single-blockquote': { leaf: (c) => [0, c], line: (c) => 2 * c },
	// The header is row 0 and the delimiter line follows it, so body row `c` sits on line `c + 1`.
	'giant-single-table': { leaf: (c) => [0, c, 2], line: (c) => c + 1 }
};

/** How far below today's edit the splice makes the same edit, on bytes today's left alone. */
const SPLICE_CHILDREN_BELOW = 8;

/** A byte as a line and a column, counted from the line's end when it sits nearer that end, so
 *  it lands alike on another line of the fixture whatever that line's length. */
interface LinePlace {
	line: number;
	column: number;
	fromEnd: boolean;
}

interface LineEdit {
	from: LinePlace;
	to: LinePlace;
	insert: string;
}

/** The edit that turned `before` into `after`, its two ends placed by line. Runs in the page. */
function lineEditOf(before: string, after: string): LineEdit {
	const shorter = Math.min(before.length, after.length);
	let from = 0;
	while (from < shorter && before[from] === after[from]) from++;
	let tail = 0;
	while (
		tail < shorter - from &&
		before[before.length - 1 - tail] === after[after.length - 1 - tail]
	)
		tail++;
	const place = (at: number): LinePlace => {
		let line = 0;
		let start = 0;
		for (;;) {
			const end = before.indexOf('\n', start);
			if (end < 0 || end >= at) {
				const length = (end < 0 ? before.length : end) - start;
				const column = at - start;
				return column * 2 > length
					? { line, column: length - column, fromEnd: true }
					: { line, column, fromEnd: false };
			}
			line++;
			start = end + 1;
		}
	};
	return {
		from: place(from),
		to: place(before.length - tail),
		insert: after.slice(from, after.length - tail)
	};
}

/** `edit` made again `lines` lines below where it was made, in `source`, the bytes it left: the
 *  new bytes and the caret after the insert. Runs in the page. */
function lineEditAt(
	source: string,
	edit: LineEdit,
	lines: number
): { next: string; caret: number } {
	// The lines `edit` added or took, since `lines` counts the lines before it was made.
	const moved = edit.insert.split('\n').length - 1 - (edit.to.line - edit.from.line);
	const byteOf = ({ line, column, fromEnd }: LinePlace): number => {
		let start = 0;
		for (let i = 0; i < line + lines + moved; i++) start = source.indexOf('\n', start) + 1;
		const end = source.indexOf('\n', start);
		return fromEnd ? (end < 0 ? source.length : end) - column : start + column;
	};
	const from = byteOf(edit.from);
	return {
		next: source.slice(0, from) + edit.insert + source.slice(byteOf(edit.to)),
		caret: from + edit.insert.length
	};
}

/** An edit at a giant container's child made today's way (a paste at its end, or Backspace over three
 *  lines), then the same bytes spliced a few children lower; each timed to the frame after it lands. */
export async function measureContainerEdit(
	page: Page,
	editor: EditorPage,
	row: {
		shape: GiantContainer;
		bytes: number;
		child: number;
		edit: 'paste' | 'removal';
		samples: number;
		mode: PresentationMode;
	}
): Promise<{ loadMs: number; today: LatencyMeasurement; splice: LatencyMeasurement }> {
	await editor.goto(row.mode === 'source' ? '' : `?presentationMode=${row.mode}`);
	const loadMs = await loadFixture(page, editor, generateFixture(row.shape, row.bytes));
	const at = CONTAINER_CHILD[row.shape];
	const leaf = at.leaf(row.child);
	await assertMounted(page, leaf, `${row.shape} child`);
	const lines = at.line(row.child + SPLICE_CHILDREN_BELOW) - at.line(row.child);
	const today: number[] = [];
	const splice: number[] = [];
	for (let i = 0; i < row.samples; i++) {
		if (row.edit === 'paste') {
			await editor.focusBlockAtPath(leaf, Number.MAX_SAFE_INTEGER);
		} else {
			await editor.focusBlockAtPath(leaf, 3);
			for (let k = 0; k < 3; k++) await page.keyboard.press('Shift+ArrowDown');
			await editor.waitForCrossBlock(true);
		}
		await page.evaluate(() => {
			(window as any).__editBefore = (window as any).__test.getSource();
		});
		today.push(row.edit === 'paste' ? await timedPaste(page) : await timedBackspace(page));
		splice.push(
			await page.evaluate(
				async ({ editOf, editAt, lines }) => {
					const w = window as any;
					const source: string = w.__test.getSource();
					const edit = new Function(`return (${editOf})`)()(w.__editBefore, source);
					const { next, caret } = new Function(`return (${editAt})`)()(source, edit, lines);
					const start = performance.now();
					// A splice that wrote nothing would time as fast as one that did.
					if (!(await w.__test.spliceSource(next, caret)))
						throw new Error('the byte splice wrote nothing');
					await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
					return performance.now() - start;
				},
				{ editOf: lineEditOf.toString(), editAt: lineEditAt.toString(), lines }
			)
		);
		// Both edits undone, so each sample starts on the bytes the first did: a table's cell clear
		// leaves its rows, and a second clear of them would write nothing.
		await editor.undo();
		await editor.undo();
		await page.waitForFunction(
			(fnSrc) => new Function(`return (${fnSrc})();`)() === (window as any).__editBefore.length,
			docLengthInPage.toString(),
			{ timeout: KEYSTROKE_TIMEOUT_MS, polling: 16 }
		);
	}
	const measured = (samples: number[]): LatencyMeasurement => ({
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95)
	});
	return { loadMs, today: measured(today), splice: measured(splice) };
}

async function timedPaste(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const start = performance.now();
		await (window as any).__test.insertMarkdown('one\ntwo');
		await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
		return performance.now() - start;
	});
}

/** Backspace over the live range, timed in the page from its keydown to the frame after block 0
 *  shrinks; a removal that took nothing fails the row rather than reading fast. */
async function timedBackspace(page: Page): Promise<number> {
	await page.evaluate((timeout) => {
		const w = window as any;
		const length = () => {
			const block = w.__test.getDocument().children[0];
			return block.leadingTrivia.length + block.raw.length;
		};
		const before = length();
		w.__removal = new Promise<number>((done, fail) => {
			const listen = () => {
				const start = performance.now();
				const poll = () =>
					requestAnimationFrame(() => {
						if (length() < before) requestAnimationFrame(() => done(performance.now() - start));
						else if (performance.now() - start > timeout)
							fail(new Error('the removal wrote nothing'));
						else poll();
					});
				poll();
			};
			window.addEventListener('keydown', listen, { capture: true, once: true });
		});
	}, KEYSTROKE_TIMEOUT_MS);
	await page.keyboard.press('Backspace');
	return page.evaluate(() => (window as any).__removal as Promise<number>);
}
