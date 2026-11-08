import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { rowContentRange } from '../../schema/reserved-chrome';
import { registerChromePluginsForTests } from './chrome-plugins';
import type { SelectionPoint } from '../../selection/primitives';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { copiedText } from '#lib/test/harness/copied-text.js';

// Source mode, where a copied range carries its bytes as they stand.
const SOURCE_READING = fixtureReading({}, 'source');

// A cross-block copy whose start lands inside a container's title line must carry the container
// with its body nested, or the whole selection reparses as bare paragraphs.

function point(path: number[], offset: number): SelectionPoint {
	return { path, offset };
}

const bodies = (node: CstNode) => node.children!.slice(1).map((c) => trimTrailingLineEnding(c.raw));
const title = (node: CstNode) =>
	trimTrailingLineEnding(node.children![0].raw.slice(rowContentRange(node).start)).trim();

describe('cross-block copy starting in reserved chrome', () => {
	beforeEach(registerChromePluginsForTests);

	it('closes the container at a body endpoint when the selection never leaves it', () => {
		const doc = parse(':::callout Title\n\nBody1\n\nBody2\n\n:::\n\nBelow\n');
		const text = copiedText(doc, point([0, 0], 13), point([0, 2], 3), SOURCE_READING);

		const reparsed = parse(text);
		expect(reparsed.children.map((c) => c.kind)).toEqual(['callout']);
		expect(bodies(reparsed.children[0])).toEqual(['Body1', 'Bod']);
	});

	it('carries a table through the container body untouched', () => {
		const doc = parse(':::callout Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n:::\n\nBelow\n');
		const text = copiedText(doc, point([0, 0], 13), point([1], 3), SOURCE_READING);

		const note = parse(text).children[0];
		expect(note.children!.map((c) => c.kind)).toEqual(['directiveOpenerLine', 'table']);
		expect(note.children![1].raw).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
	});

	// Start in the outer title line, end in the inner one: the inner container comes along closed.
	it('nests a chrome-only end container inside the opened outer', () => {
		const doc = parse(
			'::::callout Outer\n\nO1\n\n:::callout Inner\n\nI1\n\n:::\n\nO2\n\n::::\n\nBelow\n'
		);
		const text = copiedText(doc, point([0, 0], 14), point([0, 2, 0], 14), SOURCE_READING);

		const outer = parse(text).children[0];
		expect(outer.children!.map((c) => c.kind)).toEqual([
			'directiveOpenerLine',
			'paragraph',
			'callout'
		]);
		expect(title(outer.children![2])).toBe('Inn');
		expect(bodies(outer.children![2])).toEqual([]);
	});
});
