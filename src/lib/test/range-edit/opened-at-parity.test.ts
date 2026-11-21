// @vitest-environment jsdom
// The range-edit core's empty paragraph, opened where a range was (`RangeHost.openedAt`), leaves the
// bytes the caret between blocks leaves when it opens one (`insertParagraph(slot, '')`): one writer
// for both, at every container kind, at a body's first, middle and last slot.
// Miss-analysis: a composition's place reached an empty paragraph through a second commit only, so
// nothing set the core's own spelling of one beside the editor's.
import { describe, expect, it } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { testReading } from './test-host';

/** A document, the body that holds the slots by its path, and its first slot past a title row. */
const HOSTS: [name: string, source: string, parent: number[], first?: number][] = [
	['the top level', 'first\n\n***\n\nlast\n', []],
	['a quote', '> first\n>\n> ***\n>\n> last\n\nafter\n', [0]],
	['a list item', '- first\n\n  ***\n\n  last\n\nafter\n', [0, 0]],
	['a callout, a plugin box', ':::note\nfirst\n\n***\n\nlast\n:::\n\nafter\n', [0]],
	['an alert', '> [!NOTE]\n> first\n>\n> last\n\nafter\n', [0]],
	['a footnote', '[^1]: first\n\n    last\n\nafter\n', [0]],
	[
		'a details section, a plugin box with a title row',
		'<details open>\n<summary>Sum</summary>\n\nfirst\n\nlast\n\n</details>\n\nafter\n',
		[0],
		1
	]
];

describe('the core opens the paragraph the caret between blocks opens', () => {
	for (const [name, source, parent, first = 0] of HOSTS)
		it(name, async () => {
			const reading = testReading();
			const doc = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
			const count = (parent.length ? blockNodeAt(doc, parent)!.children! : doc.children).length;
			for (let index = first; index <= count; index++) {
				const core = rangeHost(reading).openedAt(doc, parent, index);
				const harness = makeEditorActionsDeps(
					readAsOpened(source, { grammar: reading.grammar, scope: 'document' }),
					{ reading }
				);
				const coordinator = createPasteCoordinator(
					harness.deps,
					createUndoController(harness.deps)
				);
				const opened = await coordinator.insertParagraph([...parent, index], '');
				expect(core?.source ?? null, `slot ${index}`).toBe(
					opened ? serialize(harness.deps.doc) : null
				);
			}
		});
});

// Miss-analysis: the parity rows held bodies of blocks alone, so nothing asked the core to open a
// paragraph among a list's items or a table's rows, which the caret between blocks never does.
describe('the core opens no paragraph among items or rows', () => {
	const PARENTS: [name: string, source: string][] = [
		['a list', '- first\n- last\n\nafter\n'],
		['a table', '| a |\n| - |\n| b |\n\nafter\n']
	];
	for (const [name, source] of PARENTS)
		it(name, () => {
			const reading = testReading();
			const doc = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
			for (const index of [0, 1]) expect(rangeHost(reading).openedAt(doc, [0], index)).toBeNull();
		});
});
