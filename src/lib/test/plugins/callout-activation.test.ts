import { describe, it, expect, beforeEach } from 'vitest';
import { getInlineRungs } from '$lib/core/inline/scan/plugin-syntax';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';

// A regression to opener-only activation stays green everywhere else, because every other
// route turns the inline `:` tier on out-of-band. The platform reset clears the inline-syntax
// registry too, leaving registerCalloutKind the only path that can claim `:`.
describe('registerCalloutKind activates the inline text tier', () => {
	beforeEach(resetPluginPlatformForTests);

	it('registers the `:` inline recognizer, not just the `:::` opener', () => {
		expect(getInlineRungs(':')).toHaveLength(0);
		registerCalloutKind();
		expect(getInlineRungs(':').length).toBeGreaterThan(0);
	});
});
