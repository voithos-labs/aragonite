// A table's rows end where the editor's grammar opens another block, read over the lines that
// follow rather than one line alone: a `$$` fence needs its closing line to open, and a syntax the
// editor switched off opens nothing. Expected shapes follow the paragraph's reading of the same
// lines, which already asks the whole grammar.
// Miss-analysis: every table-boundary pin used a one-line built-in opener under the default
// grammar, so a check that saw one line and no grammar was never contradicted.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { GrammarView } from '$lib/schema/block-openers';
import { createRegistryView } from '$lib/schema/registry-view';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { resetPluginPlatformForTests } from '$lib/testing';

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

function kinds(source: string, grammar?: GrammarView): string[] {
	const doc = parse(source, { grammar });
	expect(serialize(doc)).toBe(source);
	return doc.children.map((c) => c.kind);
}

describe('a table under the editor’s grammar', () => {
	beforeAll(() => {
		resetPluginPlatformForTests();
		registerMathBlock();
	});
	afterAll(() => resetPluginPlatformForTests());

	it('ends at a `$$` block that closes below, as a paragraph does', () => {
		expect(kinds('para\n$$\nx\n$$\n')).toEqual(['paragraph', 'mathBlock']);
		expect(kinds(TABLE + '$$\nx\n$$\n')).toEqual(['table', 'mathBlock']);
	});

	it('takes an unclosed `$$` as a row, since it opens nothing', () => {
		const doc = parse(TABLE + '$$\nx\n');

		expect(doc.children.map((c) => c.kind)).toEqual(['table']);
		expect(doc.children[0].children).toHaveLength(4);
	});

	it('takes an indented line as a row when indented code is switched off', () => {
		const off = createRegistryView({ syntax: { indentedCode: false } }).grammar;
		const doc = parse(TABLE + '    code\n', { grammar: off });

		expect(doc.children.map((c) => c.kind)).toEqual(['table']);
		expect(doc.children[0].children).toHaveLength(3);
		expect(kinds(TABLE + '    code\n')).toEqual(['table', 'indentedCode']);
	});

	it('keeps a plugin kind the editor did not list out of the check', () => {
		const withoutMath = createRegistryView({ isEnabled: (kind) => kind !== 'mathBlock' }).grammar;

		expect(kinds(TABLE + '$$\nx\n$$\n', withoutMath)).toEqual(['table']);
	});
});
