// A bundled container's name for a screen reader and the block menu is declared on its kind, not
// read back from the kind string, so renaming a kind cannot rename the block a reader hears.
// Miss-analysis: only the alert declared a label; the other two read right by the accident of
// their kind strings, and nothing pinned any of the three.
import { describe, it, expect, beforeEach } from 'vitest';
import { declaredPluginKind } from '$lib/plugin';
import { parse } from '$lib/core/parser';
import { blockAccessibleName } from '$lib/a11y-strings';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerAdmonitions } from '$lib/plugins/admonitions/admonition-kind';
import { ADMONITION, GITHUB_ALERT } from '$lib/plugins/admonitions/kinds';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerAdmonitions();
	registerDetailsKind();
});

describe('bundled container labels', () => {
	it.each([
		[ADMONITION, 'Admonition'],
		[GITHUB_ALERT, 'Alert'],
		[DETAILS, 'Details']
	])('%s declares the label %s, and its block is named by it', (name, label) => {
		const kind = declaredPluginKind(name);
		const descriptor = getBlockKindDescriptor(kind);
		expect(descriptor.label).toBe(label);
		expect(blockAccessibleName(parse(descriptor.conformanceFixture!).children[0])).toBe(label);
	});
});
