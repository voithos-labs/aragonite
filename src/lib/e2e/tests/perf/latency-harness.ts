/**
 * Shared keystroke-latency measurement for the perf e2e specs. The report
 * harness (`typing-latency`) and the regression gate (`perf-gate`) measure the
 * same way and must not drift — one definition of "type into a loaded fixture
 * and time each keystroke" lives here.
 */

import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import {
	generateFixture,
	generateDeepNested,
	deepNestedLeafPath,
	type FixtureShape
} from '../../../test/perf/fixtures/generate';

const LOAD_TIMEOUT_MS = 480_000;
const KEYSTROKE_TIMEOUT_MS = 60_000;

// Shapes whose first block is a container (list, blockquote, table):
// focusBlockEnd(0) cannot place a caret inside those — for a giant container it
// targets the last child, which is windowed out — and table-cell edits re-pad
// the whole table (breaking the +1-length settle). These rows PREPEND a plain
// paragraph so the caret target is block 0. Under windowing the per-keystroke
// cost is O(mounted), so the target must be a mounted in-window block — block 0
// is always mounted at load (scrollTop=0); an appended last block would be
// off-window and have no DOM host to type into.
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
	// Attribution over a short instrumented burst (separate from the timed loop):
	// how many block renders and which ancestry-rebuild depths one keystroke drove.
	rendersPerKeystroke: number;
	rebuildDepths: Record<number, number>;
}

// O(top-level children) CST length probe. getSource() serializes the whole doc
// per poll, which at 10MB would dwarf the latency being measured; summing raw
// lengths observes the same commit without building the string.
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

// Per-keystroke settle on block 0's OWN length term (leadingTrivia + raw) — the
// edited block's exact contribution to docLengthInPage, so it detects the commit
// at the identical point but in O(1), never summing the whole $state-proxy
// children array. The O(children) sum added a per-poll cost that scaled with
// block count and inflated flat high-block-count rows — a harness artifact, not
// editor cost (see docs/design/performance.md).
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

export function percentileMs(samples: number[], p: number): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/**
 * Load a generated fixture, then type `keystrokes` single characters into it,
 * timing each one (keystroke start → the +1-length commit settling). Returns
 * the load wall-time and the per-keystroke p50/p95.
 */
export async function measureTypingLatency(
	page: Page,
	editor: EditorPage,
	shape: FixtureShape,
	bytes: number,
	keystrokes: number
): Promise<LatencyMeasurement> {
	await editor.goto();
	const fixture = NEEDS_PROSE_TARGET.has(shape)
		? PROSE_TARGET + '\n' + generateFixture(shape, bytes)
		: generateFixture(shape, bytes);

	const loadStart = performance.now();
	await page.evaluate((content) => (window as any).__test.setSource(content), fixture);
	// serialize() may trim trailing whitespace, so settle on the trimmed length;
	// the pre-load doc is orders of magnitude smaller.
	await waitForDocLength(page, fixture.replace(/\s+$/, '').length, LOAD_TIMEOUT_MS);
	await editor.waitForRenderFlush();
	const loadMs = performance.now() - loadStart;

	const targetBlock = 0;
	await editor.focusBlockEnd(targetBlock);
	const mounted = await page.evaluate(
		(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
		targetBlock
	);
	if (!mounted)
		throw new Error(
			`perf target block ${targetBlock} is not mounted — windowing left it off-window`
		);
	const base0 = await page.evaluate(() => {
		const c = (window as any).__test.getDocument().children[0];
		return c.leadingTrivia.length + c.raw.length;
	});

	const samples: number[] = [];
	for (let i = 1; i <= keystrokes; i++) {
		const keyStart = performance.now();
		await editor.typeSlowly('x');
		await waitForBlock0Len(page, base0 + i, KEYSTROKE_TIMEOUT_MS);
		samples.push(performance.now() - keyStart);
	}

	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95)
	};
}

/**
 * The container-interior companion to {@link measureTypingLatency}: type into the
 * FIRST child of a giant single container, addressed by path, instead of a
 * prepended paragraph. Every keystroke then rewrites the container's own opener
 * line — the gesture the container kind re-derivation gate must elide, and the one
 * axis no prose-target row can see, since their caret never sits inside a
 * container. Settles on block 0's length like its prose twin: block 0 IS the
 * container here, and its raw grows by one per keystroke.
 */
export async function measureContainerHeadTyping(
	page: Page,
	editor: EditorPage,
	shape: FixtureShape,
	headLeafPath: number[],
	bytes: number,
	keystrokes: number
): Promise<LatencyMeasurement> {
	await editor.goto();
	const fixture = generateFixture(shape, bytes);

	const loadStart = performance.now();
	await page.evaluate((content) => (window as any).__test.setSource(content), fixture);
	await waitForDocLength(page, fixture.replace(/\s+$/, '').length, LOAD_TIMEOUT_MS);
	await editor.waitForRenderFlush();
	const loadMs = performance.now() - loadStart;

	const pathAttr = JSON.stringify(headLeafPath);
	const mounted = await page.evaluate(
		(attr) => !!document.querySelector(`[data-block-path='${attr}']`),
		pathAttr
	);
	if (!mounted)
		throw new Error(`container head ${pathAttr} is not mounted — windowing left it off-window`);

	// Overshooting the leaf's own length lands in focusBlockAtPath's clamp-to-end
	// fallback, so the caret sits at the head leaf's end whatever its content is.
	await editor.focusBlockAtPath(headLeafPath, Number.MAX_SAFE_INTEGER);
	const base0 = await page.evaluate(() => {
		const c = (window as any).__test.getDocument().children[0];
		return c.leadingTrivia.length + c.raw.length;
	});

	const samples: number[] = [];
	for (let i = 1; i <= keystrokes; i++) {
		const keyStart = performance.now();
		await editor.typeSlowly('x');
		await waitForBlock0Len(page, base0 + i, KEYSTROKE_TIMEOUT_MS);
		samples.push(performance.now() - keyStart);
	}

	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95)
	};
}

/**
 * The at-depth companion to {@link measureTypingLatency}: type into the DEEPEST
 * leaf of a `generateDeepNested` document, so each keystroke pays the full
 * ancestry raw rebuild the top-level path skips. The concern-4 corroboration —
 * the ancestry tax measured in the browser, where the floor class was measured.
 *
 * Settles on block 0's raw length: the ancestry rebuild propagates the typed
 * character up to the root container, so the outermost raw grows by one per
 * keystroke exactly as a top-level edit would.
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

	const loadStart = performance.now();
	await page.evaluate((content) => (window as any).__test.setSource(content), fixture);
	await waitForDocLength(page, fixture.replace(/\s+$/, '').length, LOAD_TIMEOUT_MS);
	await editor.waitForRenderFlush();
	const loadMs = performance.now() - loadStart;

	const leafPath = deepNestedLeafPath(depth);
	const pathAttr = JSON.stringify(leafPath);
	const mounted = await page.evaluate(
		(attr) => !!document.querySelector(`[data-block-path='${attr}']`),
		pathAttr
	);
	if (!mounted)
		throw new Error(`deep leaf ${pathAttr} is not mounted — nested windowing left it off-window`);

	// Caret at the leaf's end (its raw length overshoots into focusBlockAtPath's
	// clamp-to-end fallback, which is exactly end-of-leaf).
	await editor.focusBlockAtPath(leafPath, bytesPerLevel);
	const base0 = await page.evaluate(() => {
		const c = (window as any).__test.getDocument().children[0];
		return c.leadingTrivia.length + c.raw.length;
	});

	const samples: number[] = [];
	for (let i = 1; i <= keystrokes; i++) {
		const keyStart = performance.now();
		await editor.typeSlowly('x');
		await waitForBlock0Len(page, base0 + i, KEYSTROKE_TIMEOUT_MS);
		samples.push(performance.now() - keyStart);
	}

	// Attribution burst (instrumented, untimed): confirm each keystroke drives the
	// full-depth ancestry rebuild and count the block renders it triggers — the
	// signal that separates "rebuild + dev-assertion cost" from a render cascade.
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
