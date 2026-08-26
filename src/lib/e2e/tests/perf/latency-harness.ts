/**
 * Shared keystroke-latency measurement for the perf e2e specs. The report
 * harness (`typing-latency`) and the regression gate (`perf-gate`) measure the
 * same way and must not drift — one definition of "type into a loaded fixture
 * and time each keystroke" lives here.
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

// Container-first shapes get a PREPENDED paragraph: focusBlockEnd(0) would target a
// windowed-out last child, and table-cell edits re-pad the whole table (breaking the
// +1-length settle). Prepended, not appended — block 0 is the one always mounted at load.
const NEEDS_PROSE_TARGET: ReadonlySet<FixtureShape> = new Set([
	'nested-containers',
	'table-heavy',
	'giant-single-list',
	'giant-single-blockquote',
	'giant-single-table'
]);
// The trailing '\n' plus the '\n' separator yields a blank line after the
// paragraph, so it parses as a standalone block 0 ahead of the container.
const PROSE_TARGET = 'perf cursor target\n';

export interface LatencyMeasurement {
	loadMs: number;
	samples: number[];
	p50Ms: number;
	p95Ms: number;
}

export interface DeepTypingMeasurement extends LatencyMeasurement {
	// Measured over a short instrumented burst, separate from the timed loop.
	rendersPerKeystroke: number;
	rebuildDepths: Record<number, number>;
}

// getSource() serializes the whole doc per poll, which at 10MB would dwarf the latency
// being measured; summing raw lengths observes the same commit without building the string.
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

// Detects the same commit as docLengthInPage but in O(1), never summing the $state-proxy
// children array: that per-poll cost scaled with block count and inflated flat
// high-block-count rows with harness cost, not editor cost (docs/design/performance.md).
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

/** One definition of the results protocol every perf row reports through: a console line the
 *  run log is scraped for, and a JSON file under `perf-results/`. */
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
	/** Widgets matching a row's `requireWidget`, counted on the loaded document. */
	mountedWidgets?: number;
}

// ── Measurement steps ───────────────────────────────────────────────────────
// Every measure function below composes these in its own order; the sequence of awaits IS
// the measurement, so a step is moved or added only with a fresh baseline.

async function loadFixture(page: Page, editor: EditorPage, fixture: string): Promise<number> {
	const loadStart = performance.now();
	await page.evaluate((content) => (window as any).__test.setSource(content), fixture);
	// serialize() may trim trailing whitespace, so settle on the trimmed length.
	await waitForDocLength(page, fixture.replace(/\s+$/, '').length, LOAD_TIMEOUT_MS);
	await editor.waitForRenderFlush();
	return performance.now() - loadStart;
}

/** A row that typed into an unmounted host measured the wrong thing, silently: the keystroke
 *  lands on `<body>` and the settle times out instead of reporting. */
async function assertMounted(page: Page, path: number[], what: string): Promise<void> {
	const pathAttr = JSON.stringify(path);
	const mounted = await page.evaluate(
		(attr) => !!document.querySelector(`[data-block-path='${attr}']`),
		pathAttr
	);
	if (!mounted)
		throw new Error(`${what} ${pathAttr} is not mounted — windowing left it off-window`);
}

async function block0Length(page: Page): Promise<number> {
	return page.evaluate(() => {
		const c = (window as any).__test.getDocument().children[0];
		return c.leadingTrivia.length + c.raw.length;
	});
}

/** One `x` per sample, each timed to the +1-length commit block 0 must show whatever leaf
 *  took the keystroke — the ancestry rebuild propagates it up to the root. */
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
 * Type into the end of block 0 of an ALREADY-NAVIGATED page, timing each keystroke to its
 * +1-length commit. The caller owning navigation is what lets a plugins-route row and an
 * editor-route row measure identically. `requireWidget` fails the row when its rung is not
 * live, so a plugin that silently stopped installing cannot report the rung-free number.
 */
export async function measureTypingIntoDocument(
	page: Page,
	editor: EditorPage,
	fixture: string,
	keystrokes: number,
	requireWidget?: string
): Promise<DocumentTypingMeasurement> {
	const loadMs = await loadFixture(page, editor, fixture);

	// Counted before typing: the mounted set is what a per-keystroke derivation runs
	// against, so a row that measured zero widgets measured the wrong mechanism.
	let mountedWidgets: number | undefined;
	if (requireWidget !== undefined) {
		mountedWidgets = await page.locator(requireWidget).count();
		if (mountedWidgets === 0)
			throw new Error(`no ${requireWidget} mounted — the rung is not live on this route`);
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
 * presentation rung the route starts in — the axis, not a second measurement: a rung that made
 * a keystroke cost more must show up on the same samples the source rows are read from.
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
 * The container-interior companion to {@link measureTypingLatency}: the axis a prose-target row
 * can never see, since every one of those types AHEAD of the container. The caret sits at the
 * container's first child because that is the child windowing guarantees mounted, and it is also
 * the expensive end — a first-child keystroke moves the container's own opener line, so it pays
 * the kind re-derivation gate and the slot seam ask a mid-container keystroke skips.
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

	// Overshooting the leaf's own length lands in focusBlockAtPath's clamp-to-end
	// fallback, so the caret sits at that leaf's end whatever its content is.
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
 * The at-depth companion to {@link measureTypingLatency}: the deepest leaf pays the full
 * ancestry raw rebuild a top-level edit skips. The block-0 settle still holds because that
 * rebuild propagates the typed character all the way up to the root container.
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

	// Overshoots into focusBlockAtPath's clamp-to-end fallback, which is exactly end-of-leaf.
	await editor.focusBlockAtPath(leafPath, bytesPerLevel);
	const base0 = await block0Length(page);
	const samples = await sampleKeystrokes(page, editor, base0, keystrokes);

	// Instrumented and untimed, because the render count is what separates rebuild cost
	// from a render cascade — and instrumentation would distort the timings above.
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
