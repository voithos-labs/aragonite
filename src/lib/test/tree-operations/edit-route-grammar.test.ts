// Every edit route that reparses reads the editor's grammar, so none makes a kind it switched off.
// Miss-analysis: GH #429, only the split was ever tested against the editor's grammar.

import { beforeEach, describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { createRegistryView } from '#lib/schema/registry-view.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { registerBlockCompleter } from '#lib/schema/block-completions.js';
import { mergeWithNext } from '#lib/tree-operations/index.js';
import { reorderChildrenWithTrivia } from '#lib/tree-operations/reorder.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { rangeDelete } from '#lib/selection/range-delete.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { planEnterCompletion } from '#lib/editor-actions/enter-completion.js';
import type { CstNode } from '#lib/core/nodes.js';
import { describeConvergence } from '../harness/parse-converged';
import { pasteDispatch } from '#lib/tree-operations/paste/dispatch.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { makeEditorActionsDeps, makeStubBlockEdit, pasteContext } from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';

const noIndentedCode = createRegistryView({ syntax: { indentedCode: false } }).grammar;
const read = (source: string) => parse(source, { grammar: noIndentedCode });
const kindsOf = (nodes: readonly CstNode[]) => nodes.map((n) => n.kind);

beforeEach(() => {
	registerBlockCompleter(declarePluginKind('indent-box'), {
		tryComplete: (line) =>
			line === '%box' ? { lines: ['    boxed'], caret: { path: [], line: 0, column: 4 } } : null
	});
});

describe('an edit route reparses in the editor grammar', () => {
	it('a merge that leads with four spaces leaves a paragraph', () => {
		const doc = read('    lead\n\ntail\n');
		mergeWithNext(doc, 0, fixtureReading({ grammar: noIndentedCode }), createSharingState());
		expect(kindsOf(doc.children)).toEqual(['paragraph']);
		expect(describeConvergence(doc, noIndentedCode)).toBeNull();
	});

	// Flush under the prose it would be lazy text of, so only a blank line keeps it apart; the
	// global grammar reads that pair as prose then code and refuses the separator.
	it('a reorder that lands an indented paragraph under prose separates the two', () => {
		const doc = read('prose\n# h\n\n    moved\n');
		reorderChildrenWithTrivia(documentBody(doc), 2, 1, createSharingState(), noIndentedCode);
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
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: 0 }, { path: [1], offset: 1 })),
			createSharingState(),
			fixtureReading({ grammar: noIndentedCode }),
			'keyless'
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
				controller: createPasteCoordinator(deps, createUndoController(deps)),
				reading: fixtureReading({ grammar: noIndentedCode })
			})
		);
		expect(kindsOf(deps.doc.children)).not.toContain('indentedCode');
		expect(describeConvergence(deps.doc, noIndentedCode)).toBeNull();
	});
});
