import { describe, it, expect, beforeEach } from 'vitest';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { getInlineSyntax, __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';

// registerCalloutKind must activate ALL directive tiers (via activateDirectives),
// not just the `:::` block opener. The plugins route and the other unit suites turn
// the inline `:` text tier on out-of-band, so a regression of registerCalloutKind to
// opener-only activation stays green everywhere else. __resetSchemaRegistriesForTests
// leaves the inline-syntax registry alone, so this suite clears it explicitly — then
// registering the callout kind is the only path that can claim `:`.
describe('registerCalloutKind activates the inline text tier', () => {
	beforeEach(() => {
		__resetInlineSyntaxForTests();
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
	});

	it('registers the `:` inline recognizer, not just the `:::` opener', () => {
		expect(getInlineSyntax(':')).toBeUndefined();
		registerCalloutKind();
		expect(getInlineSyntax(':')).toBeDefined();
	});
});
