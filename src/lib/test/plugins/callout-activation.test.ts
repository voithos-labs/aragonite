import { describe, it, expect } from 'vitest';
import { getInlineRungs } from '#lib/core/inline/scan/plugin-syntax.js';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';

// Every other suite turns the inline `:` handler on some other way, so only here does a callout
// that registers just its `:::` opener fail. The platform reset clears the inline-syntax
// registry, leaving registerCalloutKind the only thing that can take `:`.
describe('registerCalloutKind activates the inline text level', () => {
	it('registers the `:` inline recognizer, not just the `:::` opener', () => {
		expect(getInlineRungs(':')).toHaveLength(0);
		registerCalloutKind();
		expect(getInlineRungs(':').length).toBeGreaterThan(0);
	});
});
