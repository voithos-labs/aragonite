/**
 * A live rewrite's candidate read back where it will be stored (`docs/design/live-mode.md` § 2):
 * through the position's write rules and read at its slot, as a reload reads it there. Every
 * rewrite that removes bytes reads its candidate through here.
 */

import { getContentRange, isProseKind, readInline } from '../index';
import { CONTENT_VISIBILITY, renderedText } from '../visibility';
import { isBlankText, ownTrailingLineEnding } from '../../lines';
import type { CstNode, InlineNode } from '../../nodes';
import type { NodeView } from '../../node-views';
import type { StoredAs } from '../../../schema/stored-as';

export interface ReadBack {
	/** The bytes the position stores. */
	raw: string;
	/** The one prose block they read as, or null on an inline surface. */
	block: CstNode | null;
	/** The inline tree, in the block's raw coordinates, or the stored bytes' on an inline surface. */
	inlines: InlineNode[];
	/** Leading space the reload moves into the container's marker (`- ` read as `-  `): off the
	 *  block, but still drawn, as the marker's width. */
	lead: string;
}

/** `bytes` as `store` keeps them: exactly one prose block at the slot, or the inline surface's
 *  text. Null where the reload would read anything else. */
export function readBack(bytes: string, store: StoredAs): ReadBack | null {
	const { resolver, grammar } = store.reading;
	const raw = store.stored(bytes);
	if (store.surface === 'inline') {
		return {
			raw,
			block: null,
			inlines: readInline(raw, 0, raw.length, resolver, grammar),
			lead: ''
		};
	}
	const blocks = store.readSlot(raw)?.children ?? [];
	if (blocks.length !== 1 || !isProseKind(blocks[0].kind)) return null;
	const block = blocks[0];
	const lead = raw.endsWith(block.raw) ? raw.slice(0, raw.length - block.raw.length) : '';
	if (!isBlankText(lead)) return null;
	const range = getContentRange(block);
	return {
		raw,
		block,
		inlines: readInline(block.raw, range.start, range.end, resolver, grammar),
		lead
	};
}

/** The bytes `read.inlines` index into. */
export const readSource = (read: ReadBack): string => read.block?.raw ?? read.raw;

/** What the reader sees of a read, in the content reading (live-mode.md § 2). */
export function shownOf(read: ReadBack, store: StoredAs): string {
	const render = { grammar: store.reading.grammar };
	return read.lead + renderedText(read.inlines, readSource(read), CONTENT_VISIBILITY, render);
}

/** Whether `line` still reads as `node`'s kind where `store` keeps it: always, on an inline
 *  surface, which never reads its text as a block. */
export function keepsKindAt(node: NodeView, line: string, store: StoredAs): boolean {
	if (store.surface === 'inline') return true;
	return readBack(line + ownTrailingLineEnding(node.raw), store)?.block?.kind === node.kind;
}
