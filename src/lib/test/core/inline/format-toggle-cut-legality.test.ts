// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { PresentationMode } from '$lib/presentation-mode';
import { press } from './format-toggle-fixture';

// A wrap splices its markers at the selection's endpoints, so an endpoint landing strictly inside
// an atomic construct strands a delimiter that re-pairs: the bytes move, and the range the
// selection lands on is not the one the new markers formatted. Split and absorb refused such a cut
// already; the wrap asks the same predicate. Miss-analysis: no wrap case ever placed a selection
// endpoint inside an atomic construct, so the rule sat at two of the seam's three emitters
// unobserved — sibling-path parity, one emitter short.

const MODES: PresentationMode[] = ['source', 'live'];
const ESCAPED = 'a\\*escaped\\* b';
const CODE = 'a `code` b';
const ENTITY = 'a &amp; b';

describe.each(MODES)('a wrap whose endpoint cuts a construct declines (%s)', (mode) => {
	it.each([
		['an escape', ESCAPED, 2, 10],
		['a code span', CODE, 3, 10],
		['an entity', ENTITY, 3, 9]
	])('%s', (_name, display, start, end) => {
		expect(press({ display, start, end, format: 'strong', mode }).wrote).toBeNull();
	});

	// Non-vacuity: the same constructs wrap when both endpoints sit on a boundary, and the restored
	// selection is covered by the mark.
	it.each([
		['between two escapes', ESCAPED, 3, 10, 'a\\***escaped**\\* b'],
		['around a code span', CODE, 2, 8, 'a **`code`** b'],
		['around an entity', ENTITY, 2, 7, 'a **&amp;** b']
	])('%s', (_name, display, start, end, expected) => {
		const { wrote, activeAfter } = press({ display, start, end, format: 'strong', mode });
		expect(wrote).toBe(expected);
		expect(activeAfter).toBe(true);
	});
});

// The markers a wrap mints can merge with a neighbouring run instead of forming their own span:
// `*em*` wrapped in `**` reparses as one nested stack whose strong sits inside the emphasis, so the
// restored selection is outside it. A mode that paints the delimiters keeps its literal reading —
// the reader sees the bytes and can fix them — while a mode that hides them has nothing to show and
// declines. Miss-analysis: every wrap case selected a bare word, so no marker ever re-paired.
describe('a wrap whose markers re-pair against a neighbouring run', () => {
	it('writes the literal bytes where the delimiters paint', () => {
		const { wrote, activeAfter } = press({
			display: '*em* z',
			start: 0,
			end: 4,
			format: 'strong',
			mode: 'source'
		});
		expect(wrote).toBe('***em*** z');
		expect(activeAfter).toBe(false);
	});

	it('declines where they do not', () => {
		expect(
			press({ display: '*em* z', start: 0, end: 4, format: 'strong', mode: 'live' }).wrote
		).toBeNull();
	});

	// The selection a marker-hiding mode can actually make is the content, and that one wraps.
	it('wraps the content the hidden run holds', () => {
		const { wrote, selected, activeAfter } = press({
			display: '*em* z',
			start: 1,
			end: 3,
			format: 'strong',
			mode: 'live'
		});
		expect(wrote).toBe('***em*** z');
		expect(selected).toBe('**em**');
		expect(activeAfter).toBe(true);
	});
});
