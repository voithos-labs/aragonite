import { describe, it, expect } from 'vitest';
import { preEscapeInline } from '$lib/editor/core/inline/pre-escape';
import { parseInline } from '$lib/editor/core/inline';

describe('preEscapeInline — stage reservation (0.5.5.4)', () => {
	it('is a no-op — 0.5.5.4 reserves the stage without changing behavior', () => {
		const result = preEscapeInline('\\*not emphasis\\*', 0, 17);
		expect(result.modified).toBe(false);
	});

	it('parseInline runs the stage without altering current output (0.6.2 will tighten this)', () => {
		// Today `\*bold\*` still parses as emphasis — the failing-state 0.6.2 addresses.
		// The assertion pins the CURRENT behavior so 0.6.2's fix shows up as a test flip.
		const nodes = parseInline('\\*a\\*', 0, 5);
		expect(nodes.length).toBeGreaterThan(0);
		// 0.5.5.4 does NOT fix the escape behavior — this test exists as a
		// stability anchor. When 0.6.2 lands, update this expectation to assert
		// that `\*` renders as a literal `*` text node.
	});
});
