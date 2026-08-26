// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { CONTENT_VISIBILITY, renderedText } from '$lib/core/inline/visibility';
import type { PresentationMode } from '$lib/presentation-mode';
import { press } from './format-toggle-fixture';

// A run nested inside a run of its OWN kind: shedding the inner one leaves the selection covered by
// the outer, so the answer the coverage read promised is both coming off — the outer split around
// the selection, the inner stripped inside it. Miss-analysis: every nested case in these suites and
// in the G2.14 corpus was cross-kind (`~~**mix**~~`, `***both***`), so no test ever drew a strip
// whose result a same-kind run still covered, or whose stripped content held one.

const MODES: PresentationMode[] = ['source', 'live'];

const screenOf = (display: string) =>
	renderedText(parseInline(display, 0, display.length), display, CONTENT_VISIBILITY);

describe.each(MODES)('a same-kind run nested inside another (%s)', (mode) => {
	it('splits the outer run around the inner one it strips', () => {
		const display = '~~a ~b~ c~~';
		const { active, wrote, selected, activeAfter } = press({
			display,
			start: 4,
			end: 7,
			format: 'strikethrough',
			mode
		});
		expect(active).toBe(true);
		expect(wrote).toBe('~~a~~ b ~~c~~');
		expect(selected).toBe('b');
		expect(activeAfter).toBe(false);
		expect(screenOf(wrote!)).toBe(screenOf(display));
	});

	// The strip's own content can hold a run of its kind, which only the split's marker shedding
	// used to reach: a whole-range unapply must not leave part of the range formatted.
	it.each([
		['~~a ~b~ c~~', 'strikethrough'],
		['**a **b** c**', 'strong']
	] as const)('sheds a same-kind run contained in what it strips: %s', (display, format) => {
		const { active, wrote, selected, activeAfter } = press({
			display,
			start: 0,
			end: display.length,
			format,
			mode
		});
		expect(active).toBe(true);
		expect(wrote).toBe('a b c');
		expect(selected).toBe('a b c');
		expect(activeAfter).toBe(false);
		expect(screenOf(wrote!)).toBe(screenOf(display));
	});

	it('answers the same where the delimiter run is two bytes wide', () => {
		const display = '**a **b** c**';
		const { active, wrote, selected, activeAfter } = press({
			display,
			start: 4,
			end: 9,
			format: 'strong',
			mode
		});
		expect(active).toBe(true);
		expect(wrote).toBe('**a** b **c**');
		expect(selected).toBe('b');
		expect(activeAfter).toBe(false);
		expect(screenOf(wrote!)).toBe(screenOf(display));
	});
});
