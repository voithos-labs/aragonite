import { describe, it, expect, vi } from 'vitest';
import * as preEscapeModule from '$lib/editor/core/inline/pre-escape';
import { preEscapeInline } from '$lib/editor/core/inline/pre-escape';
import { parseInline } from '$lib/editor/core/inline';

describe('preEscapeInline — stage reservation (0.5.5.4)', () => {
	it('is a no-op — 0.5.5.4 reserves the stage without changing behavior', () => {
		const result = preEscapeInline('\\*not emphasis\\*', 0, 17);
		expect(result.modified).toBe(false);
	});

	it('parseInline invokes preEscapeInline as Stage 0 (0.6.2 will flip the behavior)', () => {
		// Spy proves Stage 0 is actually called — a deletion of the preEscapeInline
		// call in parseInline would make toHaveBeenCalledTimes(1) fail.
		// Today `\*bold\*` still parses as emphasis — the failing-state 0.6.2 addresses.
		// When 0.6.2 lands, update the behavior expectation to assert that `\*`
		// renders as a literal `*` text node, but keep the invocation spy.
		const spy = vi.spyOn(preEscapeModule, 'preEscapeInline');
		parseInline('\\*a\\*', 0, 5);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith('\\*a\\*', 0, 5);
		spy.mockRestore();
	});
});
