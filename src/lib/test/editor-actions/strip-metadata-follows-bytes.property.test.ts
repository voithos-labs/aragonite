// Random keystrokes on a list item's first line leave its marker, checkbox and blocks as a reload
// of the bytes reads them, whatever the line starts with.
// Miss-analysis: the list suites typed words into items, never whitespace or a checkbox at an
// item's content start, the one place a keystroke changes what the marker reads as.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serialize } from '#lib';
import type { Document } from '#lib/core/nodes.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { contentUpdate } from '#lib/editor-actions/block-edit-core.js';
import { createPathScope } from '#lib/editor-actions/block-edit-scope.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { freshOrFixedSeed } from '#lib/test/invariants/arbitraries/index.js';

const PARAMS = { numRuns: 200, seed: freshOrFixedSeed(667640) } as const;

/** Each fixture's first item, as a path to its first block. */
const FIXTURES: [source: string, firstBlock: number[]][] = [
	['- a\n', [0, 0, 0]],
	['- a\n  b\n', [0, 0, 0]],
	['- a\n\n  b\n- c\n', [0, 0, 0]],
	['- a\n  - s\n', [0, 0, 0]],
	['1. a\n   b\n', [0, 0, 0]],
	['- [ ] a\n', [0, 0, 0]],
	['> - a\n>   b\n', [0, 0, 0, 0]],
	['> a\n> b\n', [0, 0]]
];

// The shapes a first line's start can take: indent, a checkbox, a nested opener, a wide char.
const arbPiece = fc.constantFrom(' ', '  ', '\t', '[ ] ', '[x] ', '> ', '- ', '1. ', 'é', 'x', '');

const arbEdit = fc.record({
	fixture: fc.nat({ max: FIXTURES.length - 1 }),
	lines: fc.array(fc.array(arbPiece, { maxLength: 4 }), { minLength: 1, maxLength: 3 })
});

/** The block's first line replaced by `line`, the rest of its bytes kept. */
function withFirstLine(raw: string, line: string): string {
	const nl = raw.indexOf('\n');
	return nl < 0 ? line : line + raw.slice(nl);
}

function typeFirstLine(
	doc: Document,
	path: number[],
	line: string,
	type: TypeFn
): Promise<boolean> | false {
	const block = blockNodeAt(doc, path);
	if (block?.kind !== 'paragraph') return false;
	const text = withFirstLine(block.raw, line + trimTrailingLineEnding(block.raw).split('\n')[0]);
	return type(path, text);
}

type TypeFn = (path: number[], text: string) => Promise<boolean>;

describe('a strip container’s first line, property', () => {
	it('every keystroke leaves the tree reading as its reload', async () => {
		await fc.assert(
			fc.asyncProperty(arbEdit, async ({ fixture, lines }) => {
				const [source, path] = FIXTURES[fixture];
				const { deps } = makeEditorActionsDeps(source);
				const root = { deps, controller: createUndoController(deps) };
				// The keystroke's own route: the trial reparse sends a kind change to a commit.
				const type: TypeFn = (at, text) => {
					const scope = createPathScope(root, docPathFrom(at.slice(0, -1)))!;
					return contentUpdate(scope)(at[at.length - 1], text, 'authored', 'join-typing', 0, 0);
				};
				for (const pieces of lines) {
					if (!(await typeFirstLine(deps.doc, path, pieces.join(''), type))) break;
					expect(describeConvergence(deps.doc), serialize(deps.doc)).toBeNull();
				}
			}),
			PARAMS
		);
	});
});
