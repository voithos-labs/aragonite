// A bundled block's name for a screen reader and the block menu is declared on its kind, not read
// back from the kind string, so renaming a kind cannot rename the block a reader hears.
// Miss-analysis: only the alert declared a label, and nothing pinned the other bundled names.
import { describe, it, expect, beforeEach } from 'vitest';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { blockAccessibleName } from '#lib/a11y-strings.js';
import { blockNoun } from '#lib/components/menu/default-context-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { admonitions } from '#packages/admonitions/src/index.js';
import { details } from '#packages/details/src/index.js';
import { syntaxGrammar } from '../support/syntax-grammar';

let grammar: GrammarView;
beforeEach(() => {
	grammar = syntaxGrammar([admonitions, details]);
});

const sampleOf = (kind: string) => getBlockKindDescriptor(kind as AnyBlockKind).samples![0];

describe('bundled container labels', () => {
	it.each([
		['admonitions/admonition', 'Admonition'],
		['admonitions/alert', 'Alert'],
		['details/details', 'Details']
	])('%s declares the label %s, and its block is named by it', (kind, label) => {
		const descriptor = getBlockKindDescriptor(kind as AnyBlockKind);
		expect(descriptor.label).toBe(label);
		const block = parse(sampleOf(kind), { grammar }).children[0];
		expect(block.kind).toBe(kind);
		expect(blockAccessibleName(block)).toBe(label);
	});
});

describe('bundled title-row labels', () => {
	it.each([
		['admonitions/admonition', 'directiveOpenerLine', 'Title'],
		['details/details', 'details/details.title', 'Summary']
	])('the %s title row (%s) is named %s', (container, leaf, label) => {
		// A title row never parses on its own, so it is read as its container's first child.
		const row = parse(sampleOf(container), { grammar }).children[0].children![0];
		expect(row.kind).toBe(leaf);
		expect(blockAccessibleName(row)).toBe(label);
		expect(blockNoun(row, fixtureReading())).toBe(label.toLowerCase());
	});
});
