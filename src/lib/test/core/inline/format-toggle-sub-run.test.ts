// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { PresentationMode } from '$lib/presentation-mode';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { press } from './format-toggle-fixture';

// A slice of a run (`*b*` in `**b**`) parses alone as a construct; the block's parse decides.
// Miss-analysis: every strip case selected exactly a construct the block's parse held.

const MODES: PresentationMode[] = ['source', 'live'];

const at = (
	display: string,
	start: number,
	end: number,
	format: InlineMarkKind,
	mode: PresentationMode
) => press({ display, start, end, format, mode });

describe.each(MODES)('a selection cutting into its own delimiter run (%s)', (mode) => {
	it('nests instead of stripping, since the block holds no emphasis at that range', () => {
		const { active, wrote, selected, activeAfter } = at('**bold**', 1, 7, 'emphasis', mode);
		expect(active).toBe(false);
		expect(wrote).toBe('***bold***');
		expect(selected).toBe('**bold**');
		expect(activeAfter).toBe(true);
	});

	it('nests the same way inside a non-canonical run', () => {
		const { active, wrote, activeAfter } = at('__under__', 1, 8, 'emphasis', mode);
		expect(active).toBe(false);
		expect(wrote).toBe('_*_under_*_');
		expect(activeAfter).toBe(true);
	});

	// The covering split clamps its cuts into the run's content, which leaves both halves empty,
	// so the answer the coverage read promised is the whole run coming off.
	it('unwraps the covering run rather than landing on the shorter one', () => {
		const { active, wrote, selected, activeAfter } = at('~~del~~', 1, 6, 'strikethrough', mode);
		expect(active).toBe(true);
		expect(wrote).toBe('del');
		expect(selected).toBe('del');
		expect(activeAfter).toBe(false);
	});
});
