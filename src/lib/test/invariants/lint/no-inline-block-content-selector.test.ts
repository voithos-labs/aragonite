/**
 * A block's content element is addressed by the first-non-overlay-child selector,
 * a parity rule that predates decoration badges: an inline `:scope >
 * :not(.selection-overlay)` in a spec silently breaks on a badge-bearing block
 * because it never excludes `.decoration-badge`. The one definition lives in
 * `components/block-content-selector.ts` (`BLOCK_CONTENT_SELECTOR`), re-exported
 * from the e2e page-object; specs must route their in-`evaluate` block lookups
 * through it, or the page-object helpers (`focusBlockAtPath`, `getBlock`).
 *
 * This guard fails the day a spec inlines the `:not(.selection-overlay)` exclusion
 * again, instead of at the next audit. Bare `.selection-overlay` references
 * (overlay-presence and geometry assertions) are legitimate and not matched.
 *
 * Scope is `src/lib/e2e/tests/**` only — the constant's home and the page-object
 * (which OWN the selector) live outside it and are not scanned.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectEditorSources } from './scan-source';

const E2E_TESTS_DIR = path.resolve('src/lib/e2e/tests');

// The block-content exclusion selector, not a bare `.selection-overlay` read.
const INLINE_CONTENT_SELECTOR_RE = /:not\(\s*\.selection-overlay\s*\)/;

interface SelectorHit {
	relPath: string;
}

function findInlineHits(relPath: string, code: string): SelectorHit[] {
	const re = new RegExp(INLINE_CONTENT_SELECTOR_RE.source, 'g');
	const hits: SelectorHit[] = [];
	while (re.exec(code) !== null) hits.push({ relPath });
	return hits;
}

describe('no inline block-content selector in e2e specs', () => {
	const sources = collectEditorSources(E2E_TESTS_DIR);

	it('inspected at least one e2e spec file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no spec inlines the first-non-overlay-child selector', () => {
		const violations = sources.flatMap((f) => findInlineHits(f.relPath, f.code));
		expect(
			violations.map((v) => v.relPath),
			'route block-content lookups through BLOCK_CONTENT_SELECTOR (re-exported from editor-page) or a page-object helper'
		).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher flags the inline exclusion selector, spacing tolerated', () => {
		expect(
			findInlineHits('x.spec.ts', "wrapper.querySelector(':scope > :not(.selection-overlay)')")
		).toEqual([{ relPath: 'x.spec.ts' }]);
		expect(findInlineHits('x.spec.ts', "querySelector(':not( .selection-overlay )')")).toEqual([
			{ relPath: 'x.spec.ts' }
		]);
	});

	it('matcher ignores bare overlay reads and the routed constant', () => {
		const benign =
			"page.locator('.selection-overlay')\n" +
			"page.locator('.selection-overlay-endpoint')\n" +
			'wrapper.querySelector(BLOCK_CONTENT_SELECTOR)';
		expect(findInlineHits('x.spec.ts', benign)).toEqual([]);
	});
});
