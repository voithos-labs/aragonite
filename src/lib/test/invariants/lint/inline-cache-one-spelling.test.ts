/**
 * One spelling for the inline cache. The accessor takes a resolver and a signature, and a caller
 * that drops either reads a DIFFERENT sub-entry from the one the render path filled — a
 * bracket-bearing block then answers with brackets on screen where the render showed a link. That
 * is the class the bounds seam shipped once. `resolvedInlineContent` is the one door that passes
 * both from a `linkRef`, so every non-render consumer goes through it and the raw accessor stays
 * inside its own module.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';

const CACHE_HOME = 'src/lib/core/inline/inline-cache.ts';

/**
 * The one caller that reads the raw accessor on purpose. It is the vertical-skip decision, run by
 * path walkers that hold no `linkRef` at all: passing `undefined` through the resolved door would
 * read the same sub-entry, but the header there states the resolver-less answer as its contract,
 * and hiding that behind the resolved spelling would make it look like a dropped thread.
 */
const RESOLVERLESS_BY_CONTRACT = ['src/lib/core/inline/transparency.ts'];

const RAW_ACCESSOR = /(?<![\w.])getInlineContent\s*\(/;

function rawAccessorCallers(): string[] {
	return collectEditorSources()
		.filter((file) => file.relPath !== CACHE_HOME)
		.filter((file) => RAW_ACCESSOR.test(stripComments(file.text)))
		.map((file) => file.relPath);
}

describe('inline-cache one-spelling source-scan', () => {
	it('found the resolved door in use, so the scan is not measuring an empty tree', () => {
		const resolved = collectEditorSources().filter((file) =>
			/(?<![\w.])resolvedInlineContent\s*\(/.test(stripComments(file.text))
		);
		// The keydown dispatch, the clipboard, the reveal, the render-adjacent readers.
		expect(resolved.length).toBeGreaterThan(3);
	});

	it('no consumer outside the cache reaches for the raw accessor', () => {
		expect(rawAccessorCallers()).toEqual(RESOLVERLESS_BY_CONTRACT);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher sees a bare call and skips a member read of the same name', () => {
		expect(RAW_ACCESSOR.test('const x = getInlineContent(node);')).toBe(true);
		expect(RAW_ACCESSOR.test('cache.getInlineContent(node);')).toBe(false);
	});

	it('a call inside a comment cannot trip the scan', () => {
		expect(RAW_ACCESSOR.test(stripComments('// getInlineContent(node) would be wrong'))).toBe(
			false
		);
	});
});
