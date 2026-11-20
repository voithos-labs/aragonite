// @vitest-environment jsdom
// Lines pasted into a block whose text is literal go in as written, then through the block's write
// rule as a line break typed there would: a one-line `$$` given two lines takes fence lines of its own.
// Miss-analysis: the literal rows pasted into code, whose write rule keeps the lines as written, so
// no row asked what a block that reshapes on a typed line break makes of pasted ones.
import { expect, it } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import { registerDirective } from '#lib/core/directive/registry.js';
import { editRange } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { checkHost } from './test-host';

const TABLE = '| a |\n| - |';

/** `‸` marks the caret, in the source and in the bytes the paste leaves. */
const ROWS: [name: string, marked: string, clip: string, left: string][] = [
	['one line into a one-line $$ block', '$$x‸^2$$\n', 'one', '$$xone‸^2$$\n'],
	['two lines into a one-line $$ block', '$$x‸^2$$\n', 'one\ntwo', '$$\nxone\ntwo‸^2\n$$\n'],
	['a table into a one-line $$ block', '$$x‸^2$$\n', TABLE, '$$\nx| a |\n| - |‸^2\n$$\n'],
	[
		'two lines into a one-line $$ block in a quote',
		'> $$x‸^2$$\n',
		'one\ntwo',
		'> $$\n> xone\n> two‸^2\n> $$\n'
	],
	['one line into a fenced $$ block', '$$\nx‸^2\n$$\n', 'one', '$$\nxone‸^2\n$$\n'],
	['two lines into a fenced $$ block', '$$\nx‸^2\n$$\n', 'one\ntwo', '$$\nxone\ntwo‸^2\n$$\n'],
	['one line into a code fence', '```\nco‸de\n```\n', 'one', '```\ncoone‸de\n```\n'],
	['two lines into a code fence', '```\nco‸de\n```\n', 'one\ntwo', '```\ncoone\ntwo‸de\n```\n'],
	['one line into a literal ::: block', ':::chart\nx‸y\n:::\n', 'one', ':::chart\nxone‸y\n:::\n'],
	[
		'two lines into a literal ::: block',
		':::chart\nx‸y\n:::\n',
		'one\ntwo',
		':::chart\nxone\ntwo‸y\n:::\n'
	]
];

/** A `:::chart` container whose whole bytes are one block of literal text. */
function registerChart(): void {
	const chart = declarePluginKind('chartProbe');
	registerDirective('container', 'chart', {
		kind: chart,
		fromDirective: (parsed): CstNode => ({
			kind: chart,
			leadingTrivia: parsed.leadingTrivia,
			raw: parsed.raw
		})
	});
}

for (const mode of ['source', 'live'] as Mode[])
	for (const [name, marked, clip, left] of ROWS)
		it(`${mode}: ${name}`, () => {
			const host = { ...checkHost(), transformPaste: (text: string) => text };
			registerChart();
			const at = marked.indexOf('‸');
			const gesture = { paste: clip, plain: false, holds: 'text' as const };
			const got = editRange(marked.replace('‸', ''), { from: at, to: at }, gesture, mode, host);
			expect(got.source).toBe(left.replace('‸', ''));
			expect(got.caret.at).toBe(left.indexOf('‸'));
		});
