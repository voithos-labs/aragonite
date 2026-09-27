// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { CONTENT_VISIBILITY, renderedText } from '$lib/core/inline/visibility';
import type { PresentationMode } from '$lib/presentation-mode';
import { press } from './format-toggle-fixture';
import { renderOptions } from '../../harness/fixture-grammar';

// A run inside one of its own kind: unapplying splits the outer and strips the inner, both off.
// Miss-analysis: every nested case here and in the G2.14 corpus was cross-kind.

const MODES: PresentationMode[] = ['source', 'live'];

const screenOf = (display: string) =>
	renderedText(
		parseInline(display, 0, display.length),
		display,
		CONTENT_VISIBILITY,
		renderOptions()
	);

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

	// The strip's own content can hold a run of its kind, and a whole-range unapply must not leave
	// part of the range formatted.
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
