// Every edit route that reparses reads the editor's grammar, so none makes a kind it switched off.
// Miss-analysis: GH #429, only the split was ever tested against the editor's grammar.

import { beforeEach, describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { registerBlockCompleter } from '#lib/schema/block-completions.js';
import { mergeWithNext } from '#lib/tree-operations/index.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { planEnterCompletion } from '#lib/editor-actions/enter-completion.js';
import type { CstNode } from '#lib/core/nodes.js';
import { describeConvergence } from '../harness/parse-converged';
import { fixtureReading } from '../harness/fixture-grammar';
import { deleteRange } from '../harness/range-delete';
import { reorderSettled } from '#lib/test/harness/settle-funnel.js';

const noIndentedCode = createEditorGrammar({ syntax: { indentedCode: false } });
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
		reorderSettled(documentBody(doc), 2, 1, createSharingState(), noIndentedCode);
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
		deleteRange(
			doc,
			{ path: [0], offset: 0 },
			{ path: [1], offset: 1 },
			{ reading: fixtureReading({ grammar: noIndentedCode }) }
		);
		expect(kindsOf(doc.children)).toEqual(['paragraph']);
		expect(describeConvergence(doc, noIndentedCode)).toBeNull();
	});
});
