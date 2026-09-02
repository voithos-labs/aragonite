/**
 * G4.4 — `await tick()` is the only sanctioned sequencing primitive
 * (`docs/contributing/casebook.md` § "Only `await tick()` for sequencing"). Fails on any timing primitive outside
 * the allowlist of animation-throttle / wall-clock-debounce uses. Scope excludes `test/`
 * and `e2e/`: the Playwright harness legitimately double-rAFs to wait for paint, having
 * no `tick()` equivalent across the browser boundary.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

/**
 * Files permitted a timing primitive, each with the reason it is NOT sequencing. A new
 * reason inside an allowlisted file is reviewed against these, not waved through.
 */
const ALLOWLIST: Record<string, string> = {
	// An animation cadence, not async ordering.
	'src/lib/selection/autoscroll.ts': 'rAF autoscroll loop (frame cadence)',
	// The ONE home for drag coalescing: every drag lifecycle runs on this session.
	'src/lib/selection/pointer-session.ts': 'rAF pointermove coalescing (shared drag session)',
	// Wall-clock pause detection, which microtask-grained tick() cannot express.
	'src/lib/editor-actions/commit/text-batch.ts': 'setTimeout wall-clock undo debounce',
	// A cancellation deadline, not an ordering primitive: nothing waits on the timer, and
	// no main-thread budget can interrupt a single `RegExp.exec` — hence the worker.
	'src/lib/search/regex-executor.ts': 'setTimeout regex-scan cancellation deadline',
	// An animation cadence inside one block's chrome; no editor state waits on it.
	'src/lib/plugins/parrot/ParrotBlock.svelte': 'setInterval parrot frame cadence'
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
