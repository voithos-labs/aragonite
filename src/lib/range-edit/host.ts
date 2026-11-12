/**
 * The Markdown the range-edit core reads through: the editor's own parse and byte layout, each block
 * kind's facts, and the in-block writes typing makes, so a range edit closes a format run the way
 * typing over the same text does. Built from the editor's `Reading`; the mode comes with each call.
 */

import type { DocumentView } from '../core/node-views';
import { getContentRange } from '../core/inline';
import { cutOutsideWhole } from '../core/inline/live-edit/live-split';
import { documentLineEnding, ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { makeBlockNode } from '../core/nodes';
import { hidesDelimitersAtCaret } from '../presentation-mode';
import { blockFacts, type BlockFacts } from '../schema/block-facts';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { closed as lineClosed, unfinishedReadings } from '../schema/block-openers';
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
import { splitHalves } from '../tree-operations/node-ops';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { cutKeepingStructure } from '../tree-operations/structural-suffix';
import { escapeMarkdownLiteral } from '../tree-operations/paste/markdown-literal';
import { storedAsAt, storedAsIn, writeTargetAt } from '../tree-operations/stored-as';
import { cellText } from '../core/parsers/table-line';
import { editorHost } from '../tree-operations/fix-up/editor-host';
import { blankLineBelongs } from '../tree-operations/fix-up/joins';
import { waitTakesPair } from '../tree-operations/fix-up/unfinished';
import { changesBetween } from '../tree-operations/byte-changes';
import { applied, runsOf, spliceReading } from '../tree-operations/byte-splice';
import { measured, topsOf, type Measured } from '../tree-operations/top-level-starts';
import { documentLayout, type Layout } from './layout';

export type Mode = 'source' | 'live';

/** A block beside a join a removal leaves: its bytes, and its kind where the removal knows it. */
export interface JoinSide {
	readonly raw: string;
	readonly kind?: string;
	readonly children?: readonly unknown[];
}

/** What a paste joins to a block it cuts: the text `before` the cut and `after` it, and `lead`,
 *  pasted text the second half lands behind on its line where no `after` joins it. */
export interface Joined {
	before: string;
	after: string;
	lead: string;
}

/** A block cut in two for a paste, each half in the block's own bytes: the first ends on a line
 *  ending only where the cut stands at a line's start, the second on none. */
export interface LeafCut {
	head: string;
	tail: string;
	/** Where the text joined to the second half ends in it. */
	at: number;
	/** The block is left with no text. */
	empty: boolean;
}

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
	/** Whether children `index` and `index + 1` of `parent`, left touching, need a blank line to keep
	 *  their readings; `placed` where `lower` was set apart, `stood` the child it was before a removal. */
	parts(
		doc: DocumentView,
		parent: readonly number[],
		index: number,
		upper: JoinSide,
		lower: JoinSide,
		placed: boolean,
		stood: number | null
	): boolean;
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
		/** The block with `[from, to)` written over by the joined text, then cut in it as a split cuts
		 *  it: structure past the text stays with the first half, a hidden format run closes and reopens. */
		cut(
			doc: DocumentView,
			path: readonly number[],
			from: number,
			to: number,
			joined: Joined,
			mode: Mode
		): LeafCut;
		/** The bytes `[from, to)` of the block carry out of it, a format run they cut closed. */
		carried(
			doc: DocumentView,
			path: readonly number[],
			from: number,
			to: number,
			mode: Mode
		): string;
	};
	/** `text` escaped so a block that reads Markdown shows every character of it: Paste as plain
	 *  text. A block whose text is literal takes the text as written, which the core checks. */
	escaped(text: string): string;
	/** The fence a block's bytes open, by the openers of the editor's grammar; null for none. */
	fence(raw: string): Fence | null;
}

/** The host a paste reads through: the range host, and the editor's paste transforms. */
export interface PasteHost extends RangeHost {
	/** `text`, a clipboard read as `blocks`, as the paste transforms rewrite it, or `text` itself.
	 *  The core calls it at most once per paste, and never where the clipboard lands unread as text. */
	transformPaste(text: string, blocks: DocumentView): string;
}

export interface Fence {
	/** Where the body starts in the block's bytes. */
	body: number;
	/** Where the closing line starts; null while nothing closes the fence. */
	closer: number | null;
	/** Whether a line written into the body could close the fence. */
	mayClose(line: string): boolean;
}

/** The editor's own document, whose bytes are `source`; its layout, when given, is laid out already. */
export interface CurrentDocument {
	source: string;
	measured: Measured;
	layout?: Layout;
}

/** The host over `reading`. With `current`, the editor's own tree answers a read of its own bytes,
 *  and a read of other bytes reads again only the blocks they change; the core writes to neither. */
export function rangeHost(reading: Reading, current?: CurrentDocument): RangeHost {
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
	// Each document read off the current one, with starts that measured only its new blocks.
	const reread = new WeakMap<DocumentView, Measured>();
	const parsed = (source: string) =>
		readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const readFrom = (now: CurrentDocument, source: string): DocumentView => {
		if (source === now.source) return now.measured.doc;
		// No bytes parse to no block, where the splice keeps an emptied document one paragraph.
		if (source === '') return parsed(source);
		const changes = changesBetween(now.source, source);
		const read = spliceReading(now.measured, now.source, changes, reading.grammar);
		if (!read) return now.measured.doc;
		// Off the plain list, so the blocks the bytes leave alone are copied without a read each.
		const doc = applied({ ...now.measured.doc, children: topsOf(now.measured) }, read);
		reread.set(doc, { doc, starts: now.measured.starts.after(doc, runsOf(read.windows)) });
		return doc;
	};
	return {
		read: (source) => (current ? readFrom(current, source) : parsed(source)),
		layout: (doc) =>
			doc === current?.measured.doc
				? (currentLayout ??= current.layout ?? documentLayout(current.measured))
				: documentLayout(reread.get(doc) ?? measured(doc)),
		facts: blockFacts,
		parts(doc, parent, index, upper, lower, placed, stood) {
			const fixUp = editorHost(reading.grammar);
			const owner = (parent.length > 0 && blockNodeAt(doc, parent)) || undefined;
			const block = (side: JoinSide, at: number) => {
				if (side.kind !== undefined) return { ...side, kind: side.kind, leadingTrivia: '' };
				const read = owner ? fixUp.readInSlot(owner, at, side.raw) : fixUp.readOpened(side.raw);
				return read.children[0] && { ...read.children[0], leadingTrivia: '' };
			};
			const up = block(upper, index);
			const down = block(lower, index + 1);
			const lineEnding = documentLineEnding(doc);
			const slot = { owner, index, lineEnding };
			const role = placed ? 'placed' : 'rewritten';
			if (!up || !down) return false;
			if (blankLineBelongs(fixUp, slot, up, down, role, false)) return true;
			if (stood === null) return false;
			const list = owner
				? { owner, children: owner.children ?? [], lineEnding }
				: { children: doc.children, suffix: doc.suffix, lineEnding };
			return waitTakesPair(list, index, stood, [up, down], fixUp);
		},
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
			cut(doc, path, from, to, { before, after, lead }, mode) {
				const node = leafAt(doc, path);
				const reading = readingIn(mode);
				const store = storedAsAt(doc, path, reading);
				// Plain text either side is typed as one run and cut in the middle, so both halves take
				// the caret's format; text that brings format characters joins the second half after the cut.
				const together = after !== '' && !/[*_~`[\]<\\]/.test(before + after);
				const text = together ? before + after : before;
				const last = together ? after.length : 0;
				// With no text to join, the range leaves as a removal takes it, the block's kind kept.
				const over = (leaf: typeof node, start: number, end: number) =>
					text !== '' && start < end
						? replaceDrawnRange(leaf, { start, end }, text, store)
						: replaceRangeInLeaf(leaf, { start, end }, text, store);
				let edit = over(node, from, to);
				const torn = () =>
					text !== '' &&
					reading.hidesDelimitersAtCaret() &&
					cutOutsideWhole({ ...node, raw: edit.raw }, edit.caret - last, reading) !==
						edit.caret - last;
				// A construct that splits whole takes the paste at its nearer edge, never torn around it.
				const moved = torn();
				if (moved) {
					const gone = replaceRangeInLeaf(node, { start: from, end: to }, '', store);
					const kept = { ...node, raw: gone.raw };
					const edge = cutOutsideWhole(kept, gone.caret, reading);
					edit = over(kept, edge, edge);
				}
				// Where the joined text itself grew such a construct around the cut, the cut stays literal.
				const cutIn = moved && torn() ? readingIn('source') : reading;
				const at = edit.caret - last;
				const write =
					text === '' && from === to
						? { bytes: node.raw, caret: from, after: from }
						: stored(doc, path, { raw: edit.raw, caret: at, afterRange: edit.caret });
				const written = { ...node, raw: write.bytes };
				const content = getContentRange(written);
				const { holder, index } = writeTargetAt(doc, path);
				const owner = 'owner' in holder ? holder.owner : undefined;
				const lineEnding = 'lineEnding' in holder ? holder.lineEnding : documentLineEnding(doc);
				// A half parted from its line can read as its container's own syntax (a closing tag
				// alone), so each takes the container's write rule for its body, as a split's halves do.
				const inBody = (cut: LeafCut): LeafCut => {
					const rule = owner && tryGetBlockKindDescriptor(owner.kind)?.bodyWrite;
					if (!rule) return cut;
					const ctx = { node: owner, mode: 'literal' as const, lineEnding };
					return {
						...cut,
						head: rule.normalize(cut.head, ctx),
						tail: rule.normalize(cut.tail, ctx),
						at: rule.mapOffset(cut.tail, cut.at, ctx)
					};
				};
				// The cut by the block's bytes, its structure kept; a line ending the cut stands before
				// stays the first half's line's unless text joins the second half in front of it.
				const cut = cutKeepingStructure(written, write.caret);
				let [head, tail] = [cut.head, after === '' ? cut.rest.replace(/^\r?\n/, '') : cut.rest];
				if (cutIn.hidesDelimitersAtCaret()) {
					const halves = splitHalves(written, write.caret, owner, lineEnding, {
						first: storedAsAt(doc, path, cutIn),
						second: storedAsIn(holder, index + 1, cutIn, node.kind),
						behind: lead
					});
					if (halves.reopened)
						[head, tail] = [halves.firstRaw, halves.secondRaw].map(trimTrailingLineEnding);
				}
				if (after === '')
					return inBody({ head, tail, at: 0, empty: content.start === content.end });
				// The second half ends on the block's text from the cut on, wherever it reopened.
				const kept = trimTrailingLineEnding(write.bytes).slice(write.caret, content.end);
				const seam = kept === '' ? tail.length : Math.max(tail.lastIndexOf(kept), 0);
				if (together)
					return inBody({ head, tail, at: seam + write.after - write.caret, empty: false });
				const ending = ownTrailingLineEnding(node.raw);
				const half =
					head === ''
						? { ...node, raw: tail + ending }
						: makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: tail + ending });
				const second = storedAsIn(holder, index + 1, reading, half.kind);
				const joined = replaceRangeInLeaf(half, { start: seam, end: seam }, after, second);
				tail = trimTrailingLineEnding(joined.raw);
				return inBody({ head, tail, at: joined.caret, empty: false });
			},
			carried(doc, path, from, to, mode) {
				const store = storedAsAt(doc, path, readingIn(mode));
				return bytesLeavingLeaf(leafAt(doc, path), { start: from, end: to }, store);
			}
		},
		escaped: escapeMarkdownLiteral,
		fence(raw) {
			const body = raw.indexOf('\n') + 1;
			if (body === 0) return null;
			// A fence's opening line alone waits on the line that closes it.
			const fence = lineClosed(unfinishedReadings(reading.grammar)).find((r) =>
				r.notFinal(raw.slice(0, body))
			);
			if (!fence) return null;
			const last = raw.lastIndexOf('\n', raw.length - 2) + 1;
			const closed = last >= body && !fence.notFinal(raw);
			return { body, closer: closed ? last : null, mayClose: fence.mayClose };
		}
	};
}
