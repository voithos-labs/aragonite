import { describe, it, expect } from 'vitest';
import { handlersFor } from '#lib/core/inline/scan/plugin-syntax.js';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { testView } from '#lib/test/harness/test-view.js';

// Every other suite turns the inline `:` handler on some other way, so only here does a callout
// that registers just its `:::` opener fail. The platform reset clears the inline-syntax
// registry, leaving registerCalloutKind the only thing that can take `:`.
describe('registerCalloutKind activates the inline text level', () => {
	it('registers the `:` inline recognizer, not just the `:::` opener', () => {
		expect(handlersFor(':')).toHaveLength(0);
		registerCalloutKind(testView());
		expect(handlersFor(':').length).toBeGreaterThan(0);
	});
});
