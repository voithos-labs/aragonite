// Random keystrokes on a list item's first line leave its marker, checkbox and blocks as a reload
// of the bytes reads them, whatever the line starts with.
// Miss-analysis: the list suites typed words into items, never whitespace or a checkbox at an
// item's content start, the one place a keystroke changes what the marker reads as.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serialize } from '$lib';
import type { CstNode, Document } from '$lib/core/nodes';
import { documentLineEnding, trimTrailingLineEnding } from '$lib/core/lines';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { freshOrFixedSeed } from '$lib/test/invariants/arbitraries';

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

function typeFirstLine(doc: Document, path: number[], line: string, type: TypeFn): boolean {
	const block = blockNodeAt(doc, path);
	if (block?.kind !== 'paragraph') return false;
	const text = withFirstLine(block.raw, line + trimTrailingLineEnding(block.raw).split('\n')[0]);
	return type(path, text);
}

type TypeFn = (path: number[], text: string) => boolean;

describe('a strip container’s first line, property', () => {
	it('every keystroke leaves the tree reading as its reload', () => {
		fc.assert(
			fc.property(arbEdit, ({ fixture, lines }) => {
				const [source, path] = FIXTURES[fixture];
				const { deps } = makeEditorActionsDeps(source);
				const typing = createLeafTyping(deps, createUndoController(deps));
				const type: TypeFn = (at, text) => {
					const owner = blockNodeAt(deps.doc, at.slice(0, -1)) as CstNode;
					const lineEnding = documentLineEnding(deps.doc);
					const body = { children: owner.children!, owner, lineEnding };
					const write = legalizeWrite(body, at[at.length - 1], text, 'authored');
					return typing.writeLeafInPlace(docPathFrom(at), write, 0).wrote;
				};
				for (const pieces of lines) {
					if (!typeFirstLine(deps.doc, path, pieces.join(''), type)) break;
					expect(describeConvergence(deps.doc), serialize(deps.doc)).toBeNull();
				}
			}),
			PARAMS
		);
	});
});
