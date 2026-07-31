/**
 * A block's content element is addressed through `components/block-content-selector.ts`.
 * An inline `:not(.selection-overlay)` in a spec silently breaks on a badge-bearing
 * block, never having excluded `.decoration-badge`. Bare `.selection-overlay` reads stay
 * legitimate; scope is the e2e specs, since the constant's home OWNS the selector.
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
