// @vitest-environment jsdom
// A removing rewrite's candidate read back where it is stored, and the auto-pair's kind check
// asked the same way.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { storedAsAt } from '#lib/tree-operations/stored-as.js';
import { keepsKindAt, readBack, shownOf } from '#lib/core/inline/live-edit/read-back.js';
import { fixtureReading } from '../../../harness/fixture-grammar';
import { testView } from '../../../harness/test-view';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { registerMathBlock } from '#lib/plugins/latex/latex-kind.js';

function at(source: string, path: number[]) {
	const doc = parse(source);
	return { node: nodeAt(doc, path) as CstNode, store: storedAsAt(doc, path, fixtureReading()) };
}

const shown = (source: string, path: number[], bytes: string): string | null => {
	const { store } = at(source, path);
	const read = readBack(bytes, store);
	return read && shownOf(read, store);
};

describe('reading a candidate back where it is stored', () => {
	it('shows the content behind every marker', () => {
		expect(shown('a\n', [0], '**ab** cd\n')).toBe('ab cd');
		expect(shown('- a\n', [0, 0, 0], '**ab** cd\n')).toBe('ab cd');
	});

	// The reload moves the space into the marker, where it still draws as the marker's width.
	it('a space a list marker takes still shows, as it does at the top level', () => {
		expect(shown('- a\n', [0, 0, 0], ' b\n')).toBe(' b');
		expect(shown('a\n', [0], ' b\n')).toBe(' b');
	});

	// Miss-analysis: #690, every candidate ended on a line with text, so none met the empty last
	// line the screen draws under a break and the reload reads as a blank line after the block.
	it('an empty last line after a hard break is the block’s own line, as the screen draws it', () => {
		expect(shown('a\n', [0], 'abc def\\\n\n')).toBe('abc def\n');
		expect(shown('- a\n- b\n', [0, 0, 0], 'abc def\\\n\n')).toBe('abc def\n');
		expect(shown('> a\n', [0, 0], 'abc def\\\n\n')).toBe('abc def\n');
	});

	it('refuses bytes the slot reads as anything but one prose block', () => {
		expect(shown('a\n', [0], 'a\n\nb\n')).toBeNull();
		expect(shown('a\n', [0], '```\n')).toBeNull();
		expect(shown('- a\n', [0, 0, 0], '- b\n')).toBeNull();
	});

	// Miss-analysis: #523, a cell's candidates were read as blocks, so `# ` and `- ` refused them.
	it('a cell’s text reads as text, whatever a block would make of it', () => {
		const cell = [0, 1, 0];
		expect(shown('| h |\n| - |\n| a |\n', cell, '# **ab** cd')).toBe('# ab cd');
		expect(shown('| h |\n| - |\n| a |\n', cell, '- ab')).toBe('- ab');
	});
});

describe('whether the auto-pair’s line keeps its kind where it is stored', () => {
	// Miss-analysis: the kind check read every line as a top-level fragment, and no auto-pair case
	// typed in a task item, where GFM reads `# b` as paragraph text.
	it('a task item’s `# ` paragraph stays a paragraph', () => {
		const { node, store } = at('- [ ] # b\n', [0, 0, 0]);
		expect(keepsKindAt(node, '# b**', store)).toBe(true);
	});

	it('a line that would read as another kind does not keep it', () => {
		const { node, store } = at('**\n', [0]);
		expect(keepsKindAt(node, '****', store)).toBe(false);
	});

	// Miss-analysis (#800): the kind rows read the line alone, so none asked of a lone `$$`, which
	// reads as a paragraph only until a `$$` line below closes it.
	it('a line that waits on a closer below does not keep its kind', () => {
		installPlugins([admonitionsPlugin()]);
		registerMathBlock(testView());
		const { node, store } = at('\n', [0]);
		expect(keepsKindAt(node, '$$', store)).toBe(false);
		expect(keepsKindAt(node, ':::note', store)).toBe(false);
		expect(keepsKindAt(node, '$$x', store)).toBe(true);
	});

	it('a cell keeps its kind whatever its text, since it stores no block', () => {
		const { node, store } = at('| h |\n| - |\n| a |\n', [0, 1, 0]);
		expect(keepsKindAt(node, '****', store)).toBe(true);
	});
});
