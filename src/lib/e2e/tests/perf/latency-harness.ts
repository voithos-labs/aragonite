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

// A fixture whose first block is a container gets a paragraph in front: focusBlockEnd(0) would
// aim at an unmounted last child, and editing a table cell re-pads the whole table, which
// breaks the wait for one more character. In front, not after: block 0 is always mounted.
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

// getSource() serializes the whole document on every poll, which at 10MB would cost more than
// the latency being measured; summing the raw lengths sees the same commit without building
// the string.
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

// Sees the same commit as docLengthInPage at constant cost, never summing the children array:
// summing grew with the block count and added the harness's own cost to rows with many blocks
// (docs/design/performance.md).
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

/** A row that typed into an unmounted block measured the wrong thing without saying so: the
 *  keystroke lands on `<body>` and the wait times out instead of reporting. */
async function assertMounted(page: Page, path: number[], what: string): Promise<void> {
	const pathAttr = JSON.stringify(path);
	const mounted = await page.evaluate(
		(attr) => !!document.querySelector(`[data-block-path='${attr}']`),
		pathAttr
	);
	if (!mounted) throw new Error(`${what} ${pathAttr} is not mounted, windowing left it off-window`);
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
 * Type at the end of block 0 on a page the caller already navigated to, timing each keystroke to
 * the source growing by one. Leaving navigation to the caller is what lets a row on the plugins
 * route and one on the editor route measure the same way. `requireWidget` fails the row when the
 * plugin's handler is not running, so a plugin that quietly stopped installing cannot report the
 * number for a document without it.
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
 * Load a generated fixture on the standard editor route and time typing into it. `mode` is the
 * presentation mode the route starts in, which is a variable rather than a second measurement:
 * a mode that made a keystroke cost more has to show up in the same samples.
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
 * The inside-a-container companion to {@link measureTypingLatency}: what a row with a prose
 * target can never see, since all of those type in front of the container. The caret sits on the
 * container's first child, because that is the child windowing always keeps mounted and it is
 * also the expensive one: a keystroke there moves the container's own opening line, so it pays
 * for working out the kind again and for the list bookkeeping a keystroke further in skips.
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
	const samples = await sampleKeystrokes(page, editor, base0, keystrokes);

	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95)
	};
}

/**
 * The deep-nesting companion to {@link measureTypingLatency}: the deepest child pays for
 * rebuilding the raw text of every block above it, which a top-level edit skips. The wait on
 * block 0 still works, because that rebuild carries the typed character up to the root.
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

	// Counted but not timed, because the number of renders is what tells the cost of rebuilding
	// apart from a cascade of renders, and counting would distort the timings above.
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
 * Time a vertical arrow arriving into block 1 of a three-block fixture, from block 0 above it and
 * from block 2 below it, each sample to the caret reaching block 1. The arrow back out is not
 * timed; it only sets up the next arrival.
 */
export async function measureVerticalArrival(
	page: Page,
	editor: EditorPage,
	fixture: string,
	arrivals: number
): Promise<ArrivalMeasurement> {
	const loadMs = await loadFixture(page, editor, fixture);
	await assertMounted(page, [1], 'arrival target block');

	const timeArrivals = async (from: number, toward: string, back: string): Promise<number[]> => {
		const samples: number[] = [];
		for (let i = 0; i < arrivals; i++) {
			const keyStart = performance.now();
			await page.keyboard.press(toward);
			await waitForCaretInBlock(page, 1);
			samples.push(performance.now() - keyStart);
			await page.keyboard.press(back);
			await waitForCaretInBlock(page, from);
		}
		return samples;
	};

	await editor.focusBlockEnd(0);
	const fromAbove = await timeArrivals(0, 'ArrowDown', 'ArrowUp');
	await editor.focusBlockStart(2);
	const fromBelow = await timeArrivals(2, 'ArrowUp', 'ArrowDown');
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
 * Time top-level structural edits on a loaded fixture: Enter at the end of block 0 splits off an
 * empty block, and Backspace in it merges it back, alternating. Each one changes the top-level
 * block list, so each rebuilds the whole windowing model, which a typed character never does.
 * Each sample runs to the block count changing; the p50 is over every edit.
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
