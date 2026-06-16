/**
 * Shared keystroke-latency measurement for the perf e2e specs. The report
 * harness (`typing-latency`) and the regression gate (`perf-gate`) measure the
 * same way and must not drift — one definition of "type into a loaded fixture
 * and time each keystroke" lives here.
 */

import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { generateFixture, type FixtureShape } from '../../../test/perf/fixtures/generate';

const LOAD_TIMEOUT_MS = 480_000;
const KEYSTROKE_TIMEOUT_MS = 60_000;

// Shapes whose first block is a container (list, table): focusBlockEnd(0)
// cannot place a caret inside those, and table-cell edits re-pad the whole
// table (breaking the +1-length settle). These rows PREPEND a plain paragraph
// so the caret target is block 0. Under windowing the per-keystroke cost is
// O(mounted), so the target must be a mounted in-window block — block 0 is
// always mounted at load (scrollTop=0); an appended last block would be
// off-window and have no DOM host to type into.
const NEEDS_PROSE_TARGET: ReadonlySet<FixtureShape> = new Set(['nested-containers', 'table-heavy']);
// The trailing '\n' plus the '\n' separator yields a blank line after the
// paragraph, so it parses as a standalone block 0 ahead of the container.
const PROSE_TARGET = 'perf cursor target\n';

export interface LatencyMeasurement {
	loadMs: number;
	samples: number[];
	p50Ms: number;
	p95Ms: number;
}

// O(top-level children) CST length probe. getSource() serializes the whole doc
// per poll, which at 10MB would dwarf the latency being measured; summing raw
// lengths observes the same commit without building the string.
function docLengthInPage(): number {
	const doc = (window as any).__test.getDocument();
	let length = doc.prefix.length + doc.suffix.length;
	for (const child of doc.children) length += child.leadingTrivia.length + child.raw.length;
	return length;
}

async function waitForDocLength(page: Page, min: number, timeout: number): Promise<void> {
	await page.waitForFunction(
		({ fnSrc, min }) => (new Function(`return (${fnSrc})();`)() as number) >= min,
		{ fnSrc: docLengthInPage.toString(), min },
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
	const baseLength = await page.evaluate(docLengthInPage);

	const samples: number[] = [];
	for (let i = 1; i <= keystrokes; i++) {
		const keyStart = performance.now();
		await editor.typeSlowly('x');
		await waitForDocLength(page, baseLength + i, KEYSTROKE_TIMEOUT_MS);
		samples.push(performance.now() - keyStart);
	}

	return {
		loadMs,
		samples,
		p50Ms: percentileMs(samples, 50),
		p95Ms: percentileMs(samples, 95)
	};
}
