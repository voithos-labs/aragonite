// Erasing a block's last line (text, or a setext underline) keeps the emptied line as the block's
// own, and the run below gives up the separator it doubled, so a reload reads the same blocks.
// Miss-analysis: the rebuild tests fed parser-built trees, where a paragraph never ends in a blank
// line, and no row put a blank line under the erased block, whose separator then counted twice.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createTopLevelScope } from '#lib/editor-actions/block-edit-scope.js';
import { commitLeafText } from '#lib/editor-actions/block-edit-core.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { registerFootnoteDefinition } from '#lib/plugins/footnotes/footnote-definition.js';
import { makeContainerHarness, makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { describeConvergence, describeRunDivergence } from '#lib/test/harness/parse-converged.js';
import { testView } from '#lib/test/support/test-view.js';

const reloadsAsItself = (doc: Document) => {
	expect(describeConvergence(doc)).toBeNull();
	expect(describeRunDivergence(doc)).toBeNull();
};

// ── At the top level, through both write routes ──────────────────────────────

type Write = (index: number, text: string, caret: number) => Promise<void>;

/** The two ways a top-level leaf's new text lands: through a commit, and written in place. */
const ROUTES: [string, (source: string) => { doc: Document; write: Write }][] = [
	[
		'through a commit',
		(source) => {
			const { deps } = makeEditorActionsDeps(source);
			const scope = createTopLevelScope(deps, createUndoController(deps));
			const write: Write = async (index, text, caret) => {
				const legal = legalizeWrite(scope.target(), index, text, 'authored');
				await commitLeafText(scope, index, legal, { snapshotOffset: caret, caret });
			};
			return { doc: deps.doc, write };
		}
	],
	[
		'written in place',
		(source) => {
			const { deps } = makeEditorActionsDeps(source);
			const typing = createUndoController(deps);
			const write: Write = async (index, text, caret) => {
				typing.typeLeaf(
					docPathFrom([index]),
					legalizeWrite(deps.doc, index, text, 'authored'),
					caret
				);
			};
			return { doc: deps.doc, write };
		}
	]
];

describe.each(ROUTES)('erasing the last line above a blank line, %s', (_, route) => {
	it('keeps the emptied line and drops the separator under it', async () => {
		const { doc, write } = route('a\nb\n\nc\n');
		await write(0, 'a\n\n', 2);
		expect(serialize(doc)).toBe('a\n\nc\n');
		reloadsAsItself(doc);
	});

	it('gives the separator back when the emptied line goes too', async () => {
		const { doc, write } = route('a\nb\n\nc\n');
		await write(0, 'a\n\n', 2);
		await write(0, 'a\n', 1);
		expect(doc.children.map((c) => c.raw)).toEqual(['a\n', 'c\n']);
		expect(serialize(doc)).toBe('a\n\nc\n');
		reloadsAsItself(doc);
	});

	it('gives the separator back when the emptied line gets text', async () => {
		const { doc, write } = route('a\nb\n\nc\n');
		await write(0, 'a\n\n', 2);
		await write(0, 'a\nx\n', 3);
		expect(serialize(doc)).toBe('a\nx\n\nc\n');
		reloadsAsItself(doc);
	});

	it('keeps the emptied line over the trailing blank line of the document', async () => {
		const { doc, write } = route('a\nb\n\n');
		await write(0, 'a\n\n', 2);
		expect(serialize(doc)).toBe('a\n\n');
		reloadsAsItself(doc);
	});

	it('erases a setext underline down to an empty line', async () => {
		const { doc, write } = route('Plan\n===\n\nb\n');
		for (let left = 2; left >= 0; left--) {
			await write(0, `Plan\n${'='.repeat(left)}\n`, 5 + left);
		}
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
		expect(serialize(doc)).toBe('Plan\n\nb\n');
		reloadsAsItself(doc);
	});
});

// ── Inside containers ────────────────────────────────────────────────────────

/** A container holding a setext title: its opener, its body lines' prefix, a blank body line,
 *  and the container's path. */
const CONTAINERS = [
	{ name: 'a list item', open: '- ', indent: '  ', blank: '', path: [0, 0], sibling: '- b\n' },
	{ name: 'a quote', open: '> ', indent: '> ', blank: '>', path: [0], sibling: '> b\n' },
	{
		name: 'a list item in a quote',
		open: '> - ',
		indent: '>   ',
		blank: '>',
		path: [0, 0, 0],
		sibling: '> - b\n'
	},
	{
		name: 'a footnote definition',
		open: '[^a]: ',
		indent: '    ',
		blank: '',
		path: [0],
		sibling: '    b\n'
	}
];

beforeEach(() => {
	vi.useFakeTimers();
	registerFootnoteDefinition(testView());
});

afterEach(() => {
	vi.useRealTimers();
});

describe('erasing a setext underline inside a container', () => {
	for (const { name, open, indent, blank, path, sibling } of CONTAINERS) {
		// Each follower, and the bytes of it the erase keeps.
		const followers: [string, string, string][] = [
			['', '', ''],
			[' above a sibling', sibling, sibling],
			[' above a blank line', `${blank}\n${indent}b\n`, `${indent}b\n`]
		];
		for (const underline of ['---', '===']) {
			for (const [where, follower, kept] of followers) {
				it(`${underline} in ${name}${where}`, async () => {
					const source = `${open}Plan\n${indent}${underline}\n${follower}`;
					const h = makeContainerHarness(source, path);
					expect(nodeAt(h.deps.doc, [...path, 0])?.kind).toBe('setextHeading');

					for (let left = underline.length - 1; left >= 0; left--) {
						const caret = 5 + left;
						const text = `Plan\n${underline.slice(0, left)}\n`;
						await h.bundle.blockEdit.updateBlockContent(
							0,
							text,
							'authored',
							'join-typing',
							caret + 1,
							caret
						);
					}

					expect(nodeAt(h.deps.doc, [...path, 0])?.kind).toBe('paragraph');
					reloadsAsItself(h.deps.doc);
					expect(serialize(h.deps.doc)).toContain(kept);
				});
			}
		}
	}
});
