/**
 * The two e2e caret helpers address DIFFERENT coordinate spaces and must stay
 * that way (or be unified deliberately, not by accident):
 *
 *   - `placeCaretInBlock(index, number)` counts ALL text nodes, `.md-marker`
 *     ambient spans included — a DOM-textContent offset.
 *   - `focusBlockAtPath(path, offset)` filters `.md-marker` — a raw-semantic
 *     offset, matching `pointForOffset` and the block components' own offsets.
 *
 * 45 numeric `focusBlock(index, offset)` call sites depend on the marker-counting
 * space today, so unifying is deferred (churn > payoff). This guard fails the day
 * someone flips one helper's space without the other — forcing the divergence to
 * be re-decided, not silently broken. Deferral tracked in the T2-F8 sweep.
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
