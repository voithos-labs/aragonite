// Miss-analysis: the split moved to the editor grammar with a pin of its own, and no case asked
// the merge, reorder, completion or range delete routes to reparse in anything but the global
// grammar, so each could still make a kind the editor had switched off (GH #429).

import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createRegistryView } from '$lib/schema/registry-view';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockCompleter } from '$lib/schema/block-completions';
import { mergeWithNext } from '$lib/tree-operations';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { rangeDelete } from '$lib/selection/range-delete';
import { planEnterCompletion } from '$lib/editor-actions/enter-completion';
import type { CstNode } from '$lib/core/nodes';
import { describeConvergence } from '../harness/parse-converged';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { makeEditorActionsDeps, makeStubBlockEdit, pasteContext } from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';

const noIndentedCode = createRegistryView({ syntax: { indentedCode: false } }).grammar;
const read = (source: string) => parse(source, { grammar: noIndentedCode });
const kindsOf = (nodes: readonly CstNode[]) => nodes.map((n) => n.kind);

registerBlockCompleter(declarePluginKind('indent-box'), {
	tryComplete: (line) =>
		line === '%box' ? { lines: ['    boxed'], caret: { path: [], line: 0, column: 4 } } : null
});

describe('an edit route reparses in the editor grammar', () => {
	it('a merge that leads with four spaces leaves a paragraph', () => {
		const doc = read('    lead\n\ntail\n');
		mergeWithNext(doc, 0, fixtureReading({ grammar: noIndentedCode }));
		expect(kindsOf(doc.children)).toEqual(['paragraph']);
		expect(describeConvergence(doc, noIndentedCode)).toBeNull();
	});

	// Flush under the prose it would be lazy text of, so only a blank line keeps it apart; the
	// global grammar reads that pair as prose then code and refuses the separator.
	it('a reorder that lands an indented paragraph under prose separates the two', () => {
		const doc = read('prose\n# h\n\n    moved\n');
		reorderChildrenWithTrivia(doc.children, 2, 1, createSharingState(), noIndentedCode);
		expect(kindsOf(doc.children)).toEqual(['paragraph', 'paragraph', 'heading']);
		expect(describeConvergence(doc, noIndentedCode)).toBeNull();
	});

	it('a completion whose lines lead with four spaces leaves a paragraph', () => {
		const line = { kind: 'paragraph', leadingTrivia: '', raw: '%box\n' } as CstNode;
		const completion = planEnterCompletion(line, 4, noIndentedCode, '\n');
		expect(kindsOf(completion?.replacement ?? [])).toEqual(['paragraph']);
	});

	it('a range delete whose survivor leads with four spaces leaves a paragraph', () => {
		const doc = read('first\n\nx    rest\n');
		rangeDelete(
			doc,
			{ path: [0], offset: 0 },
			{ path: [1], offset: 1 },
			createSharingState(),
			fixtureReading({ grammar: noIndentedCode })
		);
		expect(kindsOf(doc.children)).toEqual(['paragraph']);
		expect(describeConvergence(doc, noIndentedCode)).toBeNull();
	});

	// A context with no join cleanup, as the insertMarkdown route builds one: the split halves
	// still read the dispatch's own grammar.
	it('a structural paste that splits an indented paragraph leaves both halves prose', async () => {
		const { deps } = makeEditorActionsDeps(read('    lead tail\n'));
		await pasteDispatch(
			{ pastedText: 'a\n\nb\n', targetPath: [0], offset: '    lead'.length },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: createPasteCoordinator(createUndoController(deps), deps.revealPath),
				reading: fixtureReading({ grammar: noIndentedCode })
			})
		);
		expect(kindsOf(deps.doc.children)).not.toContain('indentedCode');
		expect(describeConvergence(deps.doc, noIndentedCode)).toBeNull();
	});
});
