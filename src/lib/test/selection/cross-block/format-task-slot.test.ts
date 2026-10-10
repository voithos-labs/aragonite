// Miss-analysis: the cross-block format suites toggled plain paragraphs, cells and task text,
// and none took a mark off text that then opened with a checkbox in a plain item's first slot.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { CstNode } from '#lib/core/nodes.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '#lib/selection/cross-block/format-range.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { coverRange } from '#lib/selection/range-coverage.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';

// A format toggle writes each covered leaf in place, and one in a list item's first slot keeps the
// item's checkbox in step with the text it leaves there, as a reload reads it.

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** Kinds and task flags all the way down: what the tree holds and what its reload must match. */
function shape(nodes: readonly CstNode[]): unknown[] {
	return nodes.map((node) => [
		node.kind,
		node.kind === 'listItem' ? (node.metadata as { taskItem: boolean }).taskItem : null,
		shape(node.children ?? [])
	]);
}

describe('a cross-block format toggle over a list item’s first slot', () => {
	it('taking the bold off `**[ ] a**` makes the plain item a task, as its reload reads it', () => {
		const doc = parse('- **[ ] a**\n\n**b**\n');
		const plan = planCrossBlockFormat(
			doc,
			coverRange(doc, at([0, 0, 0], 0), at([1], 5)),
			'strong',
			fixtureReading()
		);
		applyCrossBlockFormat(documentBody(doc), plan!, createSharingState(), defaultGrammarView);

		const written = serialize(doc);
		expect(written).toBe('- [ ] a\n\nb\n');
		expect(shape(doc.children)).toEqual(shape(parse(written).children));
	});
});
