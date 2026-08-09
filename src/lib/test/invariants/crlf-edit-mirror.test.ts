/**
 * G4.20 CRLF-mirror oracle — an edit's output bytes depend on the document's line
 * ending only through that ending. Each gesture runs twice over one fixture, once
 * LF-authored and once mirrored to CRLF, and the CRLF result must be the LF result
 * mirrored. Any other byte difference is the bug.
 *
 * An outcome oracle rather than another source-scan arm because most G4.20 breaches carry
 * no literal shape to scan for (a blank-line comparison, a default parameter three calls
 * down), and because this fires for gesture N+1 without being taught about it.
 */

import { describe, it, expect } from 'vitest';
import type { CstNode, Document } from '../../core/nodes';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { displayLength, trimTrailingLineEnding } from '../../core/lines';
import { insertHardBreak } from '../../components/blocks/text/text-keydown';
import { computeFenceExit } from '../../components/blocks/code/code-fence-exit';
import { codePasteSurface } from '../../components/blocks/code/code-paste-surface';
import { metadataOf } from '../../core/nodes';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildTableRaw,
	rebuildTableRowRaw
} from '../../schema/container-rebuilders';
import { insertEmptyRow } from '../../tree-operations/table-mutations';
import { rangeDelete } from '../../selection/range-delete';
import { createSharingState } from '../../tree-operations/sharing';
import { ensureEditableContainers } from '../../tree-operations/node-ops';
import { buildExitReplacement } from '../../tree-operations/list/exit-replacement';

interface EditGesture {
	name: string;
	/** LF-authored fixture; the harness mirrors it to CRLF and runs the gesture twice. */
	source: string;
	/** Apply the gesture to the parsed document and return the bytes it emitted. */
	apply: (doc: Document) => string;
}

/** Bytes of a node list an op produced but has not yet spliced into a document. */
const serializeNodes = (nodes: CstNode[]) =>
	nodes.map((n) => (n.leadingTrivia ?? '') + n.raw).join('');

const GESTURES: EditGesture[] = [
	{
		name: 'hard break at end of display',
		source: 'abc\n',
		apply: (doc) => insertHardBreak(doc.children[0].raw, displayLength(doc.children[0].raw)).newRaw
	},
	{
		name: 'hard break mid display',
		source: 'abc\n',
		apply: (doc) => insertHardBreak(doc.children[0].raw, 1).newRaw
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
		apply: (doc) => serializeNodes(buildExitReplacement(doc.children[0], 1).blocks)
	},
	{
		name: 'empty-container backfill',
		source: '- \n',
		apply: (doc) => {
			const item = doc.children[0].children![0];
			ensureEditableContainers(item);
			return serializeNodes(item.children!);
		}
	},
	{
		name: 'range delete consuming two prose endpoints whole',
		source: 'aaa\n\nbbb\n\nccc\n',
		apply: (doc) =>
			serialize(
				rangeDelete(
					doc,
					{ path: [0], offset: 0 },
					{ path: [1], offset: displayLength(doc.children[1].raw) },
					createSharingState(),
					undefined,
					undefined
				).newDoc
			)
	},
	{
		name: 'range delete out of a blockquote (reserved-chrome branch)',
		source: '> q\n\nafter\n',
		apply: (doc) =>
			serialize(
				rangeDelete(
					doc,
					{ path: [0, 0], offset: 0 },
					{ path: [1], offset: displayLength(doc.children[1].raw) },
					createSharingState(),
					undefined,
					undefined
				).newDoc
			)
	},
	{
		name: 'range delete out of a table (table branch)',
		source: '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n',
		apply: (doc) =>
			serialize(
				rangeDelete(
					doc,
					{ path: [0], offset: 0, cellCoordinate: true },
					{ path: [1], offset: displayLength(doc.children[1].raw) },
					createSharingState(),
					undefined,
					undefined
				).newDoc
			)
	},
	{
		// The document empties, so nothing survives to read an ending from — which is why
		// the ending has to be captured before the delete.
		name: 'range delete emptying the document across two tables',
		source: '| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |\n',
		apply: (doc) =>
			serialize(
				rangeDelete(
					doc,
					{ path: [0], offset: 0, cellCoordinate: true },
					{ path: [1], offset: 1, cellCoordinate: true },
					createSharingState(),
					undefined,
					undefined
				).newDoc
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
			return codePasteSurface.onInlinePaste!(node, caret, 'X').newRaw;
		}
	}
];

const mirrorToCrlf = (bytes: string) => bytes.replace(/\n/g, '\r\n');

describe('G4.20 CRLF-mirror oracle', () => {
	for (const gesture of GESTURES) {
		it(`${gesture.name} emits the CRLF mirror of its LF result`, () => {
			// Mirror-identity, not "contains no lone LF": an untouched line rewritten under a
			// blank-line test that never matched a bare CR is a byte difference with no stray LF.
			const lf = gesture.apply(parse(gesture.source));
			const crlf = gesture.apply(parse(mirrorToCrlf(gesture.source)));
			expect(crlf).toBe(mirrorToCrlf(lf));
		});
	}
});
