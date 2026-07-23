import { describe, expect, it } from 'vitest';
import { registerInlineSyntax } from '$lib/plugin';

// WALL PIN — pins the BARE-form throw only. A prefix recognizer on `[` now exists
// (the inline priority ladder), so `[^label]` will become a first-class footnote
// kind through a `[^`-prefix rung. What stays reserved is the BARE `[` registration:
// the built-in scanner dispatches `[` before the plugin registry, so a bare rung
// would never fire. Retire this pin when the footnotes plugin lands its prefix rung.
describe('WALL PIN: a bare `[` registration is unavailable to plugins', () => {
	it('rejects registering a bare recognizer on the `[` trigger', () => {
		expect(() => registerInlineSyntax('[', () => null)).toThrow(/claimed by the built-in scanner/);
	});
});
