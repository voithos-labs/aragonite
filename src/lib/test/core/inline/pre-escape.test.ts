import { describe, it, expect, vi } from 'vitest';
import * as preEscapeModule from '$lib/editor/core/inline/pre-escape';
import { preEscapeInline } from '$lib/editor/core/inline/pre-escape';
import { parseInline } from '$lib/editor/core/inline';

describe('preEscapeInline — stage reservation', () => {
	it('is a no-op — reserves the stage without changing behavior', () => {
		const result = preEscapeInline('\\*not emphasis\\*', 0, 17);
		expect(result.modified).toBe(false);
	});

	it('parseInline invokes preEscapeInline as Stage 0', () => {
		const spy = vi.spyOn(preEscapeModule, 'preEscapeInline');
		parseInline('\\*a\\*', 0, 5);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith('\\*a\\*', 0, 5);
		spy.mockRestore();
	});
});
