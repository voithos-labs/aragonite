// A bundled block's name for a screen reader and the block menu is declared on its kind, not read
// back from the kind string, so renaming a kind cannot rename the block a reader hears.
// Miss-analysis: only the alert declared a label, and nothing pinned the other bundled names.
import { describe, it, expect, beforeEach } from 'vitest';
import { declaredPluginKind } from '#lib/plugin.js';
import { parse } from '#lib/core/parser.js';
import { blockAccessibleName } from '#lib/a11y-strings.js';
import { blockNoun } from '#lib/components/menu/default-context-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { registerAdmonitions } from '#lib/plugins/admonitions/admonition-kind.js';
import { ADMONITION, ADMONITION_TITLE, GITHUB_ALERT } from '#lib/plugins/admonitions/kinds.js';
import {
	registerDetailsKind,
	DETAILS,
	DETAILS_SUMMARY
} from '#lib/plugins/details/details-kind.js';

beforeEach(() => {
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

describe('bundled title-row labels', () => {
	it.each([
		[ADMONITION, ADMONITION_TITLE, 'Title'],
		[DETAILS, DETAILS_SUMMARY, 'Summary']
	])('the %s title row (%s) is named %s', (container, leaf, label) => {
		// A title row never parses on its own, so it is read as its container's first child.
		const fixture = getBlockKindDescriptor(declaredPluginKind(container)).conformanceFixture!;
		const row = parse(fixture).children[0].children![0];
		expect(row.kind).toBe(declaredPluginKind(leaf));
		expect(blockAccessibleName(row)).toBe(label);
		expect(blockNoun(row, fixtureReading())).toBe(label.toLowerCase());
	});
});
