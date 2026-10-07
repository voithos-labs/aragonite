// @vitest-environment jsdom
// Miss-analysis: the render pin ran on the default stack, where a one-frame recursive renderer
// still fits 4,000 levels.
// The `deep-stack` project runs this file on a 150 KB stack, which a recursive renderer overflows
// below 300 levels; a worker needs about 100 KB just to start.
import { describe, it, expect } from 'vitest';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { renderOptions } from '../harness/fixture-grammar';

const LEVELS = 2_400;

describe('inline render at input-controlled nesting depth, on a small stack', () => {
	it('renders past the recursion ceiling with full byte coverage', () => {
		const raw = '*'.repeat(2 * LEVELS) + 'a' + '*'.repeat(2 * LEVELS);
		const frag = renderInlineNodes(parseInline(raw, 0, raw.length), raw, renderOptions());

		expect(frag.textContent).toBe(raw);
		// jsdom's insert bookkeeping grows faster than the depth, so the render takes seconds.
	}, 60_000);
});
