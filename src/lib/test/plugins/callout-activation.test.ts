import { describe, it, expect, beforeEach } from 'vitest';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { getInlineRungs, __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';

// A regression to opener-only activation stays green everywhere else, because every
// other route turns the inline `:` tier on out-of-band. So this suite clears the
// inline-syntax registry itself (the schema reset leaves it alone), leaving
// registerCalloutKind as the only path that can claim `:`.
describe('registerCalloutKind activates the inline text tier', () => {
	beforeEach(() => {
		__resetInlineSyntaxForTests();
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
	});

	it('registers the `:` inline recognizer, not just the `:::` opener', () => {
		expect(getInlineRungs(':')).toHaveLength(0);
		registerCalloutKind();
		expect(getInlineRungs(':').length).toBeGreaterThan(0);
	});
});
