// @vitest-environment jsdom
// Miss-analysis: the iterative-walk source scan follows only call cycles in which every function
// reads children, so a DOM walk recursing through a helper passed it.
// The `deep-stack` project runs this file on a 150 KB stack, which a recursive walk overflows well
// below 2,400 levels.
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { CONTENT_VISIBILITY, visibleRuns } from '../../core/inline/visibility';
import { renderOptions } from '../harness/fixture-grammar';

const LEVELS = 2_400;

describe('rendered-DOM walks at input-controlled nesting depth, on a small stack', () => {
	// jsdom's insert bookkeeping grows faster than the depth, so rendering the chain takes seconds.
	it('tiles the rendered source in order past the recursion ceiling', () => {
		const raw = '*'.repeat(2 * LEVELS) + 'a' + '*'.repeat(2 * LEVELS);
		const runs = visibleRuns(
			parseInline(raw, 0, raw.length),
			raw,
			CONTENT_VISIBILITY,
			renderOptions()
		);

		expect(runs[0].start).toBe(0);
		expect(runs[runs.length - 1].end).toBe(raw.length);
		expect(runs.findIndex((run, i) => i > 0 && run.start !== runs[i - 1].end)).toBe(-1);
		expect(
			runs
				.filter((run) => run.visible)
				.map((run) => run.text)
				.join('')
		).toBe('a');
	}, 60_000);
});
