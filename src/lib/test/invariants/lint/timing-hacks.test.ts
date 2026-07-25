/**
 * G4.4 — `await tick()` is the only sanctioned sequencing primitive
 * (`docs/contributing/culture.md` § Sharp edges). Scans editor source for `setTimeout`/`setInterval`/
 * `queueMicrotask`/`requestAnimationFrame` and fails on any occurrence outside
 * the allowlist of legitimate animation-throttle / wall-clock-debounce uses.
 *
 * Scope excludes `test/` and `e2e/`: this governs editor runtime sequencing.
 * The Playwright harness legitimately double-rAFs to "wait for paint" — there
 * is no `tick()` equivalent across the browser boundary.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/**
 * Files permitted to use a timing primitive, each with the reason it is NOT
 * sequencing. Adding a timing hack anywhere else trips this guard; adding one
 * to an allowlisted file for a NEW reason should be reviewed against these
 * rationales, not waved through.
 */
const ALLOWLIST: Record<string, string> = {
	// rAF autoscroll loop — frame-paced scrolling during pointer drag, an
	// animation cadence, not async ordering.
	'src/lib/selection/autoscroll.ts': 'rAF autoscroll loop (frame cadence)',
	// rAF coalesces pointermove bursts to one handler per frame. This is the ONE
	// home for drag coalescing — every drag lifecycle (cross-block selection,
	// block/row/column reorder, table cell) runs on this session.
	'src/lib/selection/pointer-session.ts': 'rAF pointermove coalescing (shared drag session)',
	// setTimeout is wall-clock pause detection for undo debounce ("user stopped
	// typing ~250ms"). tick() is microtask-grained and cannot express a wall-clock
	// pause — documented at the call site.
	'src/lib/editor-actions/commit/text-batch.ts': 'setTimeout wall-clock undo debounce',
	// setTimeout is the cancellation deadline on an off-thread regex scan, not an
	// ordering primitive: nothing waits on the timer, and the only thing it can do
	// is terminate a worker stuck inside an uninterruptible `RegExp.exec`. tick()
	// cannot express a wall-clock ceiling, and no main-thread budget can interrupt
	// a single exec at all — which is why the worker exists.
	'src/lib/search/regex-executor.ts': 'setTimeout regex-scan cancellation deadline'
};

const TIMING_RE = /\b(setTimeout|setInterval|queueMicrotask|requestAnimationFrame)\s*\(/;

interface TimingHit {
	relPath: string;
	primitive: string;
}

function findTimingHits(relPath: string, code: string): TimingHit[] {
	const re = new RegExp(TIMING_RE.source, 'g');
	const hits: TimingHit[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(code)) !== null) {
		hits.push({ relPath, primitive: m[1] });
	}
	return hits;
}

describe('G4.4 no timing hacks for sequencing', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every timing primitive lives in an allowlisted file', () => {
		const violations = sources
			.flatMap((f) => findTimingHits(f.relPath, f.code))
			.filter((hit) => !(hit.relPath in ALLOWLIST));
		expect(violations).toEqual([]);
	});

	it('every allowlist entry still has a live timing primitive (no dead allowlist)', () => {
		const byPath = new Map(sources.map((f) => [f.relPath, f]));
		for (const relPath of Object.keys(ALLOWLIST)) {
			const file = byPath.get(relPath);
			expect(file, `allowlisted file not found: ${relPath}`).toBeDefined();
			expect(TIMING_RE.test(file!.code), `allowlist stale for ${relPath}`).toBe(true);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher flags each timing primitive', () => {
		for (const primitive of [
			'setTimeout',
			'setInterval',
			'queueMicrotask',
			'requestAnimationFrame'
		]) {
			expect(findTimingHits('synthetic.ts', `${primitive}(() => x, 0)`)).toEqual([
				{ relPath: 'synthetic.ts', primitive }
			]);
		}
	});

	it('matcher ignores clear/cancel and type-position uses', () => {
		const benign =
			'clearTimeout(id);\n' +
			'cancelAnimationFrame(raf);\n' +
			'let t: ReturnType<typeof setTimeout> | null = null;';
		expect(findTimingHits('synthetic.ts', benign)).toEqual([]);
	});
});
