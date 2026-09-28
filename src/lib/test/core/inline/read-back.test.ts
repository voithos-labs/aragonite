// @vitest-environment jsdom
// A removing rewrite's candidate read back where it is stored, and the auto-pair's kind check
// asked the same way.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { keepsKindAt, readBack, shownOf } from '$lib/core/inline/live-edit/read-back';
import { fixtureReading } from '../../harness/fixture-grammar';

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

	it('refuses bytes the slot reads as anything but one prose block', () => {
		expect(shown('a\n', [0], 'a\n\nb\n')).toBeNull();
		expect(shown('a\n', [0], '```\n')).toBeNull();
		expect(shown('- a\n', [0, 0, 0], '- b\n')).toBeNull();
	});

	// #523 miss: a cell's candidates were read as blocks, so `# ` and `- ` refused every one.
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

	it('a cell keeps its kind whatever its text, since it stores no block', () => {
		const { node, store } = at('| h |\n| - |\n| a |\n', [0, 1, 0]);
		expect(keepsKindAt(node, '****', store)).toBe(true);
	});
});
