/**
 * G4.20: an edit's output bytes depend on the document's line ending only through that ending.
 * Each gesture runs twice over one fixture, once written with LF and once mirrored to CRLF, and
 * the CRLF result has to be the LF result mirrored. Any other byte difference is the bug.
 *
 * It checks the outcome rather than scanning the source, because most breaches have no literal
 * shape to scan for (a blank-line comparison, a default parameter three calls down) and because
 * this catches the next gesture without being taught about it.
 */

import { describe, it, expect } from 'vitest';
import type { CstNode, Document } from '../../core/nodes';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { displayLength, documentLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { insertHardBreak } from '../../components/blocks/text/text-keydown';
import { computeFenceExit } from '../../components/blocks/code/code-fence-exit';
import { codePasteSurface } from '../../components/blocks/code/code-paste-surface';
import { tableCellPasteSurface } from '../../components/blocks/table/table-cell-paste';
import { metadataOf } from '../../core/nodes';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildTableRaw,
	rebuildTableRowRaw
} from '../../schema/container-rebuilders';
import { insertEmptyRow } from '../../tree-operations/table-mutations';
import { rangeDelete } from '../../selection/range-delete';
import type { SelectionPoint } from '../../selection/primitives';
import { createSharingState } from '../../tree-operations/sharing';
import { ensureEditableContainers } from '../../tree-operations/node-primitives';
import { buildExitReplacement } from '../../tree-operations/list/exit-replacement';
import { pasteDispatch } from '../../tree-operations/paste/dispatch';
import { createPasteCoordinator } from '../../editor-actions/paste-coordinator';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createBlockEditActions } from '../../editor-actions/block-edit';
import { fixtureReading } from '../harness/fixture-grammar';
import { makeEditorActionsDeps, makeTopHarness, pasteContext } from '../harness/editor-actions';
import { blockContextActionsFor } from '../../schema/context-actions';
import { everyInstalledPlugin } from '../../schema/plugin-activation';
import { registerCodeContextActions } from '../../components/blocks/code/code-context-actions';
import { allowDevWarns } from '../support/warn-gate';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { ensurePasteSurface } from '$lib/test/support/paste-surface';

interface EditGesture {
	name: string;
	/** LF-authored fixture; the harness mirrors it to CRLF and runs the gesture twice. */
	source: string;
	/** Apply the gesture to the parsed document and return the bytes it emitted. */
	apply: (doc: Document) => string | Promise<string>;
}

/** Bytes of a node list an op produced but has not yet spliced into a document. */
const serializeNodes = (nodes: CstNode[]) =>
	nodes.map((n) => (n.leadingTrivia ?? '') + n.raw).join('');

/** Paste `clipboard` into `doc` through the real per-level bundle. The clipboard is LF on both
 *  runs, as every paste entry point normalizes it, so the pasted lines mirror only when the
 *  paste writes them in the document's ending. */
async function pasteInto(
	doc: Document,
	targetPath: number[],
	offset: number,
	clipboard: string
): Promise<Document> {
	__resetSchemaRegistriesForTests();
	ensurePasteSurface(tableCellPasteSurface);
	ensurePasteSurface(codePasteSurface);
	const { deps } = makeEditorActionsDeps(doc);
	const controller = createUndoController(deps);
	await pasteDispatch(
		{ pastedText: clipboard, targetPath, offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(controller, deps.revealPath),
			undoEntry: 'own'
		})
	);
	return deps.doc;
}

/** A range delete's emitted bytes. The grammar, mode and resolver arguments stay `undefined`:
 *  this test reads the line ending, and none of the three moves one. */
const deleteBetween = (doc: Document, start: SelectionPoint, end: SelectionPoint) =>
	serialize(rangeDelete(doc, start, end, createSharingState(), fixtureReading()).newDoc);

const GESTURES: EditGesture[] = [
	{
		name: 'hard break at end of display',
		source: 'abc\n',
		apply: (doc) =>
			insertHardBreak(
				doc.children[0].raw,
				displayLength(doc.children[0].raw),
				documentLineEnding(doc)
			).newRaw
	},
	{
		name: 'hard break mid display',
		source: 'abc\n',
		apply: (doc) => insertHardBreak(doc.children[0].raw, 1, documentLineEnding(doc)).newRaw
	},
	{
		name: 'blockquote rebuild across a blank quote line',
		source: '> a\n>\n> b\n',
		apply: (doc) => {
			rebuildBlockquoteRaw(doc.children[0]);
			return doc.children[0].raw;
		}
	},
	{
		name: 'list item rebuild across a blank continuation line',
		source: '- a\n\n  b\n',
		apply: (doc) => {
			const item = doc.children[0].children![0];
			rebuildListItemRaw(item);
			return item.raw;
		}
	},
	{
		name: 'table rebuild',
		source: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
		apply: (doc) => {
			rebuildTableRaw(doc.children[0]);
			return doc.children[0].raw;
		}
	},
	{
		name: 'table row insert',
		source: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
		apply: (doc) => {
			const table = doc.children[0];
			insertEmptyRow(table, 1, 'below');
			rebuildTableRowRaw(table.children![2]);
			rebuildTableRaw(table);
			return table.raw;
		}
	},
	{
		name: 'list exit minting the paragraph below the list',
		source: '- a\n- b\n',
		apply: (doc) =>
			serializeNodes(buildExitReplacement(doc.children[0], 1, documentLineEnding(doc)).blocks)
	},
	{
		name: 'empty-container backfill',
		source: '- \n',
		apply: (doc) => {
			const item = doc.children[0].children![0];
			ensureEditableContainers(item, documentLineEnding(doc));
			return serializeNodes(item.children!);
		}
	},
	{
		name: 'range delete consuming two prose endpoints whole',
		source: 'aaa\n\nbbb\n\nccc\n',
		apply: (doc) =>
			deleteBetween(
				doc,
				{ path: [0], offset: 0 },
				{ path: [1], offset: displayLength(doc.children[1].raw) }
			)
	},
	{
		name: 'range delete out of a blockquote (reserved-chrome branch)',
		source: '> q\n\nafter\n',
		apply: (doc) =>
			deleteBetween(
				doc,
				{ path: [0, 0], offset: 0 },
				{ path: [1], offset: displayLength(doc.children[1].raw) }
			)
	},
	{
		name: 'range delete out of a table (table branch)',
		source: '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n',
		apply: (doc) =>
			deleteBetween(
				doc,
				{ path: [0], offset: 0, cellCoordinate: true },
				{ path: [1], offset: displayLength(doc.children[1].raw) }
			)
	},
	{
		// The document empties, so nothing survives to read an ending from, which is why the
		// ending has to be captured before the delete.
		name: 'range delete emptying the document across two tables',
		source: '| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |\n',
		apply: (doc) =>
			deleteBetween(
				doc,
				{ path: [0], offset: 0, cellCoordinate: true },
				{ path: [1], offset: 1, cellCoordinate: true }
			)
	},
	{
		name: 'fence exit minting a closer on an unclosed fence',
		source: '```js\ncode\n\n',
		apply: (doc) => {
			const node = doc.children[0];
			const text = trimTrailingLineEnding(node.raw);
			const exit = computeFenceExit({
				text,
				offset: text.length,
				meta: metadataOf(node, 'fencedCode')
			});
			return exit.kind === 'closeAndExit' ? exit.newText : `UNEXPECTED ${exit.kind}`;
		}
	},
	{
		name: 'paste into a fenced code block',
		source: '```\ncode\n```\n',
		apply: (doc) => {
			const node = doc.children[0];
			const caret = node.raw.indexOf('code') + 'code'.length;
			return codePasteSurface.onInlinePaste!(node, caret, 'X', undefined, fixtureReading(), '\n')
				.newRaw;
		}
	},
	{
		name: 'structural paste landing the clipboard’s trailing blank at the document tail',
		source: 'x\n',
		apply: async (doc) => serialize(await pasteInto(doc, [0], 1, '# h\n\n'))
	},
	{
		name: 'fence exit on the empty line above the closer',
		source: '```\nfoo\n\n```\n',
		apply: (doc) => {
			const node = doc.children[0];
			const text = trimTrailingLineEnding(node.raw);
			const exit = computeFenceExit({
				text,
				// The empty line starts just past the break that ends `foo`.
				offset: text.indexOf('\n', text.indexOf('foo')) + 1,
				meta: metadataOf(node, 'fencedCode')
			});
			return exit.kind === 'exitWithEdit' ? exit.newText : `UNEXPECTED ${exit.kind}`;
		}
	},
	{
		name: 'dissolving a fence into text',
		source: '```\nfoo\nbar\n```\n',
		apply: (doc) => dissolveBlock(doc, 0)
	},
	{
		// Miss-analysis: every dissolve fixture had a line break inside the fence to copy.
		name: 'dissolving a lone opener on the last line',
		source: 'a\n\n```',
		apply: (doc) => dissolveBlock(doc, 1)
	},
	...unterminatedTail(),
	...pasteRoutes()
];

/** The bytes the code block's "Dissolve into text" row writes for the block at `index`. */
async function dissolveBlock(doc: Document, index: number): Promise<string> {
	registerCodeContextActions();
	const node = doc.children[index];
	const dissolve = blockContextActionsFor(node, [index], everyInstalledPlugin, 'block').find(
		(action) => action.id === 'code.dissolve'
	);
	const written: string[] = [];
	await dissolve!.run({
		node,
		path: [index],
		deleteBlock: async () => {},
		replaceRaw: async (raw) => void written.push(raw),
		transformPaste: (text) => text,
		lineEnding: documentLineEnding(doc)
	});
	return written.join('');
}

// Miss-analysis: every fixture above ends in a line ending, so no gesture ever had to choose one
// for a block without its own, the last line of a document that has none (#458).
function unterminatedTail(): EditGesture[] {
	return [
		{
			name: 'Enter at the end of an unterminated last line',
			source: 'abc\n\nlast',
			apply: async (doc) => {
				const harness = makeTopHarness(doc);
				await harness.actions.splitBlock(1, 'last'.length);
				return serialize(harness.deps.doc);
			}
		},
		{
			name: 'paste of blocks at the end of an unterminated last line',
			source: 'abc\n\nlast',
			apply: async (doc) => serialize(await pasteInto(doc, [1], 'last'.length, 'x\n\ny'))
		},
		{
			name: 'list exit below an unterminated list',
			source: 'abc\n\n- a\n- ',
			apply: (doc) =>
				serializeNodes(buildExitReplacement(doc.children[1], 1, documentLineEnding(doc)).blocks)
		},
		{
			name: 'table rebuild of an unterminated table',
			source: 'abc\n\n| a |\n| --- |\n| 1 |',
			apply: (doc) => {
				rebuildTableRaw(doc.children[1]);
				return doc.children[1].raw;
			}
		}
	];
}

/** One row per route a paste can take into the tree, each pasting lines of its own. A drop has
 *  no row: it moves no text holding a line break. */
function pasteRoutes(): EditGesture[] {
	const paste =
		(path: number[], offset: number | ((doc: Document) => number), clipboard: string) =>
		async (doc: Document): Promise<string> => {
			const at = typeof offset === 'number' ? offset : offset(doc);
			return serialize(await pasteInto(doc, path, at, clipboard));
		};
	// The harness mounts no container, so a route committing at one warns that its scope is
	// unmounted, which is not what these rows are about.
	const inContainer =
		(apply: EditGesture['apply']) =>
		async (doc: Document): Promise<string> => {
			const bytes = await apply(doc);
			allowDevWarns(['paste']);
			return bytes;
		};
	// A code block's offsets count its opening fence line, whose ending the mirror lengthens.
	const afterCode = (doc: Document) => doc.children[0].raw.indexOf('code') + 'code'.length;
	return [
		{ name: 'block paste at a soft break', source: 'abc\nAfter\n', apply: paste([0], 3, 'x\n\ny') },
		{ name: 'inline paste of two lines', source: 'abc\nAfter\n', apply: paste([0], 3, 'x\ny') },
		{
			name: 'blocks pasted into a table cell',
			source: '| a | b |\n| --- | --- |\n| c |  |\n\nAfter\n',
			apply: paste([0, 1, 1], 0, 'x\n\ny')
		},
		{
			name: 'items into a list',
			source: '- a\n- b\n',
			apply: inContainer(paste([0, 0, 0], 1, '- one\n- two'))
		},
		{
			name: 'a list breaking out of a list',
			source: '1. a\n',
			apply: paste([0, 0, 0], 1, '- x\n- y')
		},
		{
			name: 'a quote into a quote',
			source: '> a\n',
			apply: inContainer(paste([0, 0], 1, '> q\n> r'))
		},
		{
			name: 'lines into a code block',
			source: '```\ncode\n```\n',
			apply: paste([0], afterCode, 'x\ny')
		}
	];
}

const mirrorToCrlf = (bytes: string) => bytes.replace(/\n/g, '\r\n');

describe('G4.20 CRLF-mirror check', () => {
	for (const gesture of GESTURES) {
		it(`${gesture.name} emits the CRLF mirror of its LF result`, async () => {
			// Mirror-identity, not "contains no lone LF": an untouched line rewritten under a
			// blank-line test that never matched a bare CR is a byte difference with no stray LF.
			const lf = await gesture.apply(parse(gesture.source));
			const crlf = await gesture.apply(parse(mirrorToCrlf(gesture.source)));
			expect(crlf).toBe(mirrorToCrlf(lf));
		});
	}
});
