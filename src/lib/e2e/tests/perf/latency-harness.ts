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
// `focusBlockEnd(0)` would aim at an unmounted last child, and a table cell edit re-pads the table.
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
