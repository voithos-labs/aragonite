/**
 * A live rewrite's candidate read back where it will be stored (`docs/design/live-mode.md` § 2):
 * through the position's write rules and read at its slot, as a reload reads it there, except that
 * an empty last line stays the block's own, as the screen draws it. Every rewrite that removes
 * bytes reads its candidate through here.
 */

import { getContentRange, isProseKind, openLinesAtEnd, readInline } from '../index';
import { CONTENT_VISIBILITY, visibleRuns, type VisibleRun } from '../visibility';
import { landsKeepingMarks, shownSpan, type ShownSpan } from './shown-marks';
import type { ContentRange } from '../index';
import type { Reading } from '../../../schema/reading';
import { unfinishedReadings, waitingReading } from '../../../schema/block-openers';
import { isBlankText, ownTrailingLineEnding, trimTrailingLineEnding } from '../../lines';
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
	/** The lines after a final hard break, which the write drops and the pending break draws. */
	openLines: number;
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
			lead: '',
			openLines: 0
		};
	}
	const blocks = store.readSlot(raw)?.children ?? [];
	if (blocks.length !== 1 || !isProseKind(blocks[0].kind)) return null;
	const parsed = blocks[0];
	const at = raw.indexOf(parsed.raw);
	// The reload reads an empty last line as a blank line after the block; the screen keeps it.
	const tail = at < 0 ? '' : raw.slice(at + parsed.raw.length);
	const kept = isBlankText(tail);
	const lead = at < 0 || !kept ? '' : raw.slice(0, at);
	if (!isBlankText(lead)) return null;
	const block = kept && tail !== '' ? { ...parsed, raw: parsed.raw + tail } : parsed;
	const range = getContentRange(block);
	return {
		raw,
		block,
		inlines: readInline(block.raw, range.start, range.end, resolver, grammar),
		lead,
		openLines: openLinesAtEnd(trimTrailingLineEnding(bytes))?.lines ?? 0
	};
}

/** The bytes `read.inlines` index into. */
export const readSource = (read: ReadBack): string => read.block?.raw ?? read.raw;

/** What the reader sees of a read, in the content reading (live-mode.md § 2). */
export const shownOf = (read: ReadBack, store: StoredAs): string => shownRunsOf(read, store).shown;

/** {@link shownOf}, with the runs it was drawn from, so a check on what each character carries
 *  costs no second render. */
export function shownRunsOf(
	read: ReadBack,
	store: StoredAs
): { shown: string; runs: VisibleRun[] } {
	const render = { grammar: store.reading.grammar };
	const runs = visibleRuns(read.inlines, readSource(read), CONTENT_VISIBILITY, render);
	let text = '';
	for (const run of runs) if (run.visible) text += run.text;
	return { shown: read.lead + text + '\n'.repeat(read.openLines), runs };
}

/** Whether `line` still reads as `node`'s kind where `store` keeps it, whatever lines come below
 *  it: always, on an inline surface, which never reads its text as a block. */
export function keepsKindAt(node: NodeView, line: string, store: StoredAs): boolean {
	if (store.surface === 'inline') return true;
	const block = readBack(line + ownTrailingLineEnding(node.raw), store)?.block;
	// A lone `$$` reads as a paragraph only until a `$$` line below closes it.
	const readings = unfinishedReadings(store.reading.grammar);
	return block?.kind === node.kind && waitingReading(block.raw, readings) === null;
}

/** What `[from, to)` of `raw` shows, its content being `range`: text and each character's marks. */
export function shownOfSpan(
	raw: string,
	range: ContentRange,
	from: number,
	to: number,
	reading: Reading
): ShownSpan {
	const { resolver, grammar } = reading;
	const inlines = readInline(raw, range.start, range.end, resolver, grammar);
	const runs = visibleRuns(inlines, raw, CONTENT_VISIBILITY, { grammar });
	return shownSpan(runs, inlines, raw, from, to);
}

/** Whether `bytes`, read back where `store` keeps them, show the parts in order, each character in
 *  its own marks (the landed part may take the marks around it too). */
export function readsInParts(
	bytes: string,
	parts: { before: ShownSpan; landed: ShownSpan; after: ShownSpan },
	store: StoredAs
): boolean {
	const read = readBack(bytes, store);
	if (read === null) return false;
	const source = readSource(read);
	const { runs } = shownRunsOf(read, store);
	return landsKeepingMarks(shownSpan(runs, read.inlines, source, 0, source.length), parts);
}
