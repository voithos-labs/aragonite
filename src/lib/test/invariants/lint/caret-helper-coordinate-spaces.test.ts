/**
 * The two e2e caret helpers address DIFFERENT coordinate spaces: `placeCaretInBlock`
 * counts ALL text nodes including `.md-marker` ambient spans, `focusBlockAtPath` filters
 * them for a raw-semantic offset. Dozens of numeric call sites depend on the
 * marker-counting one, so unification is deferred (T2-F8 sweep) and this fails the day
 * one helper's space flips without the other.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.resolve('src/lib/e2e/editor-page.ts'), 'utf8');

// The marker-reject filter lives in the raw-semantic walkers' acceptNode only;
// the header prose mentions `.md-marker` but never the bracketed selector form.
const MARKER_FILTER = 'md-marker[contenteditable';

const firstWarn = src.indexOf('COORDINATE-SPACE WARNING');
const secondWarn = src.indexOf('COORDINATE-SPACE WARNING', firstWarn + 1);
const userActions = src.indexOf('// ── User Actions', secondWarn);

const placeCaretRegion = src.slice(firstWarn, secondWarn);
const focusAtPathRegion = src.slice(secondWarn, userActions);

describe('caret-helper coordinate spaces stay divergent', () => {
	it('both regions were located', () => {
		expect(firstWarn).toBeGreaterThanOrEqual(0);
		expect(secondWarn).toBeGreaterThan(firstWarn);
		expect(userActions).toBeGreaterThan(secondWarn);
	});

	it('placeCaretInBlock does not filter markers (marker-counting space)', () => {
		expect(placeCaretRegion).not.toContain(MARKER_FILTER);
	});

	it('focusBlockAtPath filters markers (raw-semantic space)', () => {
		expect(focusAtPathRegion).toContain(MARKER_FILTER);
	});
});
