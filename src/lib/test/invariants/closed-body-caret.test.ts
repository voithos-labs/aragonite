// @vitest-environment node
// G1.245's predicate: a caret's leaf in the body of a closed container is the violation; the title
// row, an open body and a leaf outside are not.
// Miss-analysis: the rule lived in a package's toggle, so nothing held a landing to it.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { listGrammar } from '#lib/schema/own-syntax.js';
import { checkNoCaretInClosedBody } from '#lib/invariants/closed-body-caret.js';
import { collapsedContainerHiding } from '#lib/selection/path-lookup.js';
import { folds, FOLD_SAMPLE } from '#lib/test/support/fold-fixture.js';

function read(source: string) {
	const { grammar } = listGrammar([folds], ({ cause }) => {
		throw cause;
	});
	return parse(source, { grammar });
}

describe('G1.245 a closed body holds no caret', () => {
	const CLOSED = `above\n\n${FOLD_SAMPLE}`;
	const OPEN = CLOSED.replace('[fold]', '[fold open]');

	it('names a caret in a closed body and the container hiding it', () => {
		expect(checkNoCaretInClosedBody(read(CLOSED), [1, 1], collapsedContainerHiding)).toMatchObject({
			code: 'closed-body-caret',
			detail: { path: [1, 1], container: [1] }
		});
	});

	it.each([
		['the title row', CLOSED, [1, 0]],
		['an open body', OPEN, [1, 1]],
		['a block outside', CLOSED, [0]]
	])('passes a caret on %s', (_name, source, path) => {
		expect(checkNoCaretInClosedBody(read(source), path, collapsedContainerHiding)).toBeNull();
	});
});
