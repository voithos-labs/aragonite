/**
 * The Markdown the range-edit core reads through: the editor's own parse and byte layout, each block
 * kind's facts, and the in-block writes typing makes, so a range edit closes a format run the way
 * typing over the same text does. Built from the editor's `Reading`; the mode comes with each call.
 */

import type { DocumentView } from '../core/node-views';
import { documentLineEnding } from '../core/lines';
import { hidesDelimitersAtCaret } from '../presentation-mode';
import { blockFacts, readsOnBareLine, type BlockFacts } from '../schema/block-facts';
import { unfinishedReadings } from '../schema/block-openers';
import { readAsOpened } from '../schema/opened-reading';
import type { Reading } from '../schema/reading';
import { legalizeWrite } from '../tree-operations/content-write';
import {
	bytesLeavingLeaf,
	joinLeaves,
	replaceDrawnRange,
	replaceRangeInLeaf,
	type LeafRangeEdit
} from '../tree-operations/leaf-range';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { escapeMarkdownLiteral } from '../tree-operations/paste/markdown-literal';
import { storedAsAt, writeTargetAt } from '../tree-operations/stored-as';
import { cellText } from '../core/parsers/table-line';
import { documentLayout, type Layout } from './layout';

export type Mode = 'source' | 'live';

/** One in-block write, offsets into the block's new bytes. */
export interface LeafWrite {
	bytes: string;
	caret: number;
	/** Where the block's bytes past the written range start. */
	after: number;
}

export interface RangeHost {
	read(source: string): DocumentView;
	layout(doc: DocumentView): Layout;
	facts(kind: string): BlockFacts;
	/** Whether a bare line right after a block of `kind` with bytes `raw` reads as part of it. */
	readsOnBareLine(kind: string, raw: string): boolean;
	leaf: {
		replace(
			doc: DocumentView,
			path: readonly number[],
			from: number,
			to: number,
			text: string,
			mode: Mode
		): LeafWrite;
		insert(
			doc: DocumentView,
			path: readonly number[],
			at: number,
			text: string,
			mode: Mode
		): LeafWrite;
		/** The block at `head.path` cut at its offset, with the text of the block at `tail.path` from
		 *  its offset joined on: the tail's own syntax (a setext underline) goes, the head's stays. */
		join(
			doc: DocumentView,
			head: { path: readonly number[]; offset: number },
			tail: { path: readonly number[]; offset: number },
			mode: Mode
		): LeafWrite;
		/** The bytes `[from, to)` of the block carry out of it, a format run they cut closed. */
		carried(
			doc: DocumentView,
			path: readonly number[],
			from: number,
			to: number,
			mode: Mode
		): string;
		/** `text` as Paste as plain text writes it into the block: escaped where its text reads
		 *  Markdown, as written where it is literal. */
		plain(doc: DocumentView, path: readonly number[], text: string): string;
	};
	/** The fence a block's bytes open, by the openers of the editor's grammar; null for none. */
	fence(raw: string): Fence | null;
}

export interface Fence {
	/** Where the body starts in the block's bytes. */
	body: number;
	/** Where the closing line starts; null while nothing closes the fence. */
	closer: number | null;
	/** Whether a line written into the body could close the fence. */
	mayClose(line: string): boolean;
}

/** The host over `reading`. With `current`, the editor's own tree answers a read of its own bytes,
 *  and its layout, when given, is laid out already; the core never writes to either. */
export function rangeHost(
	reading: Reading,
	current?: { source: string; tree: DocumentView; layout?: Layout }
): RangeHost {
	// The editor's reading at the moment of the write, in the gesture's mode.
	const readingIn = (mode: Mode): Reading => ({
		grammar: reading.grammar,
		resolver: reading.resolver,
		resolverSignature: reading.resolverSignature,
		resolverEpoch: reading.resolverEpoch,
		mode: () => mode,
		hidesDelimitersAtCaret: () => hidesDelimitersAtCaret(mode)
	});
	const leafAt = (doc: DocumentView, path: readonly number[]) => {
		const node = blockNodeAt(doc, path);
		if (!node || node.children?.length) throw new Error(`no text block at [${path.join(',')}]`);
		return node;
	};
	// An in-block write as the block stores it: its kind's write rule, then its container's (a fence
	// grows past a fence line written into its body), with the offsets carried through that rule.
	const stored = (
		doc: DocumentView,
		path: readonly number[],
		edit: Pick<LeafRangeEdit, 'raw' | 'caret' | 'afterRange'>
	): LeafWrite => {
		const { holder, index } = writeTargetAt(doc, path);
		const legal = legalizeWrite(holder, index, edit.raw, 'literal', reading.grammar);
		const row = blockNodeAt(doc, path.slice(0, -1));
		// A row writes a cell's edge spaces as padding, so the cell keeps its text without them.
		const bytes = row && blockFacts(row.kind).lines === 'cells' ? cellText(legal.text) : legal.text;
		const lead = legal.text.indexOf(bytes);
		const at = (offset: number) => Math.min(Math.max(offset - lead, 0), bytes.length);
		return {
			bytes,
			caret: at(legal.storedOffset(edit.caret)),
			after: at(legal.storedOffset(edit.afterRange))
		};
	};
	let currentLayout: Layout | undefined;
	return {
		read: (source) =>
			source === current?.source
				? current.tree
				: readAsOpened(source, { grammar: reading.grammar, scope: 'document' }),
		layout: (doc) =>
			doc === current?.tree
				? (currentLayout ??= current.layout ?? documentLayout(doc))
				: documentLayout(doc),
		facts: blockFacts,
		readsOnBareLine,
		leaf: {
			replace(doc, path, from, to, text, mode) {
				const store = storedAsAt(doc, path, readingIn(mode));
				const edit = replaceDrawnRange(leafAt(doc, path), { start: from, end: to }, text, store);
				return stored(doc, path, edit);
			},
			insert(doc, path, at, text, mode) {
				const store = storedAsAt(doc, path, readingIn(mode));
				const edit = replaceRangeInLeaf(leafAt(doc, path), { start: at, end: at }, text, store);
				return stored(doc, path, edit);
			},
			join(doc, head, tail, mode) {
				const store = storedAsAt(doc, head.path, readingIn(mode));
				const { raw, seam } = joinLeaves(
					{ node: leafAt(doc, head.path), offset: head.offset },
					{ node: leafAt(doc, tail.path), offset: tail.offset },
					'',
					store,
					documentLineEnding(doc)
				);
				return stored(doc, head.path, { raw, caret: seam, afterRange: seam });
			},
			carried(doc, path, from, to, mode) {
				const store = storedAsAt(doc, path, readingIn(mode));
				return bytesLeavingLeaf(leafAt(doc, path), { start: from, end: to }, store);
			},
			plain(doc, path, text) {
				const literal = blockFacts(leafAt(doc, path).kind).body === 'literal';
				return literal ? text : escapeMarkdownLiteral(text);
			}
		},
		fence(raw) {
			const body = raw.indexOf('\n') + 1;
			if (body === 0) return null;
			// A fence's opening line alone waits on the line that closes it.
			const fence = unfinishedReadings(reading.grammar).find(
				(r) => r.closer !== null && r.notFinal(raw.slice(0, body))
			);
			if (!fence) return null;
			const last = raw.lastIndexOf('\n', raw.length - 2) + 1;
			const closed = last >= body && !fence.notFinal(raw);
			return { body, closer: closed ? last : null, mayClose: fence.mayClose };
		}
	};
}
