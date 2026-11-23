/**
 * A paste through the range-edit core: the clipboard over a place read as bytes, and the core's
 * answer landed in one commit. A paste that is one write of a top-level text block commits as that
 * block's own write, the one a typed letter ends in, where that write leaves the core's bytes; any
 * other lands as a byte splice. Wherever the core writes text into a block, a paste's or a key's
 * over a range, the step of the block it lands in spends it (`textHost`), before either. A kind
 * that answers a paste itself (a table cell's grid and slice) goes first. Every paste route ends
 * here, whatever brought the clipboard.
 */

import type { CommitSnapshotArg, UndoGrouping } from '../../action-contracts';
import type { TextEdit } from '../../caret/next-insertion';
import { docPathFrom } from '../../core/coordinate-spaces';
import { isBlankText, ownTrailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import type { DocumentView } from '../../core/node-views';
import type { AnyBlockKind } from '../../core/nodes';
import type { DocumentGetter } from '../../editor-keys';
import { assertPasteLanded } from '../../invariants/install';
import { withLeafBytes } from '../../range-edit/document';
import { editRange, type RangeEditResult } from '../../range-edit/edit-range';
import { restored } from '../../range-edit/own-entry';
import {
	rangeHost,
	type CurrentDocument,
	type LeafWrite,
	type PasteHost,
	type RangeHost
} from '../../range-edit/host';
import type { LeafEdit } from '../../range-edit/leaf-splice';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { Reading } from '../../schema/reading';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { getPasteSurface, type ClipPasteInput } from '../../tree-operations/paste-surfaces';
import { splicedBytes } from '../../tree-operations/spliced-openers';
import {
	rewrittenPaste,
	type PastedClip,
	type RewrittenClip
} from '../../tree-operations/paste/paste-rewrites';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import type { CaretLanding } from '../caret-landing';
import {
	endsOf,
	placeInBlock,
	placeRead,
	pointAtByte,
	rangeRead,
	removalBytes,
	type PasteAim,
	type PastePlace,
	type RangeRead
} from '../range-bytes';
import type { RangeCoverage } from '../range-coverage';
import type { SelectionState } from '../selection-state.svelte';
import { commitBytes, modeOf, type CommitContext } from './range-removal';

export type PasteContext = CommitContext & {
	getDoc: DocumentGetter;
	selection: Pick<SelectionState, 'collapse'>;
	/** The plugins this editor activated, whose paste rewrites run where a paste lands as blocks. */
	activePlugins: PluginActivation;
	pasteCoordinator: PasteCommitCoordinator;
	caretLanding: Pick<CaretLanding, 'restore'>;
};

/** The step of the block text lands in (`BlockComponent.holdInsertion`): its hidden edge and what
 *  the caret memory holds for it, spent on the block's text as a typed letter's write spends them. */
export type SpendInsertion = (before: string, edit: TextEdit) => TextEdit;

/** Raw offsets `[start, end]` of the text block at `path`, a caret where they meet. */
export interface BlockSpan {
	path: readonly number[];
	start: number;
	end: number;
}

/** Pastes `clip` over `span` in one commit: the answer the block's kind gives itself where it has
 *  one, else the core's. False where nothing was written. */
export async function pasteInBlock(
	ctx: PasteContext,
	span: BlockSpan,
	clip: RewrittenClip,
	undo: CommitSnapshotArg,
	spend: SpendInsertion | null
): Promise<boolean> {
	if (await answeredAhead(ctx, span.path, clip, null)) return true;
	const live = modeOf(ctx) === 'live';
	const { path, start, end } = span;
	const aim = { named: [path], place: () => placeInBlock(ctx.bytes, path, start, end, live) };
	return pasteThroughCore(ctx, aim, takenBy(ctx, path, clip), undo, spend);
}

/** `clip` as the kind of the text block at `path` takes text in. */
function takenBy(ctx: PasteContext, path: readonly number[], clip: RewrittenClip): RewrittenClip {
	const node = blockNodeAt(ctx.getDoc(), path);
	const text = node && getPasteSurface(node.kind, ctx.activePlugins)?.pastedText?.(clip.text);
	return text === undefined || text === null ? clip : { ...clip, text };
}

/** Whether the kind of the text block at `path` answered the paste itself, ahead of the core;
 *  `cells` are the cells of its table the editor holds selected. */
export async function answeredAhead(
	ctx: PasteContext,
	path: readonly number[],
	clip: RewrittenClip,
	cells: ClipPasteInput['cells']
): Promise<boolean> {
	const doc = ctx.getDoc();
	const node = clip.text ? blockNodeAt(doc, path) : null;
	const answer = node && getPasteSurface(node.kind, ctx.activePlugins)?.onClipPaste;
	if (!answer) return false;
	return answer({
		doc,
		targetPath: [...path],
		clip,
		cells,
		controller: ctx.pasteCoordinator,
		reading: ctx.reading,
		activePlugins: ctx.activePlugins
	});
}

/** `clip`'s text as the plugins' paste rewrites leave it, `read` the clipboard read as blocks:
 *  the one call of every route that lands a paste as blocks outside the core's own answer. */
export function rewrittenClip(
	reading: Reading,
	plugins: PluginActivation,
	clip: PastedClip,
	read: () => DocumentView
): string {
	return rewrittenPaste(clip, read, plugins, reading.grammar, rangeHost(reading).parts);
}

/** Pastes `clip` at the place `aim` finds in one commit, whose undo puts the caret back at `undo`;
 *  `spend` is the step of the block it lands in. False where it changed nothing or was refused. */
export async function pasteThroughCore(
	ctx: PasteContext,
	aim: PasteAim,
	clip: RewrittenClip,
	undo: CommitSnapshotArg,
	spend: SpendInsertion | null
): Promise<boolean> {
	const read = placeRead(ctx.bytes, aim);
	if (!read) return false;
	const { place } = read;
	const answer = pasteAnswer(ctx, read, place, clip, spend);
	// A paste its rewrites empty is a paste of nothing, which removes nothing, as in a cell.
	if (!answer) return false;
	if (answer.source === read.source) {
		// A range pasted over with its own bytes is written nowhere, and still ends where they end.
		if (place.range.from !== place.range.to) await endRangeAt(ctx, answer.caret.at);
		return false;
	}
	return landAnswer(ctx, read.source, answer, undo);
}

/** The core's answer for `clip` pasted at `place` in `doc`; null where its rewrites leave none of
 *  the clipboard. */
function pasteAnswer(
	ctx: PasteContext,
	doc: CurrentDocument,
	place: PastePlace,
	clip: RewrittenClip,
	spend: SpendInsertion | null
): RangeEditResult | null {
	let emptied = false;
	const host: PasteHost = textHost(ctx.reading, doc, spend, (text, blocks) => {
		const out = rewrittenPaste(
			{ ...clip, text },
			() => blocks,
			ctx.activePlugins,
			ctx.reading.grammar,
			host.parts
		);
		emptied = isBlankText(out) && !isBlankText(text);
		return out;
	});
	const { range, ...held } = puttingBack(place, clip, doc.source);
	const gesture = { paste: clip.text, plain: clip.plain, own: clip.own, ...held };
	const answer = editRange(doc.source, range, gesture, modeOf(ctx), host);
	return emptied ? null : answer;
}

/** The core's answer over a range, the read it was answered on and the host that read it. */
export interface PlaceAnswer {
	read: RangeRead;
	answer: RangeEditResult;
	host: RangeHost;
}

/** The core's answer for a key's text, spent by the step of the block it lands in, or the place text
 *  would take, over what `coverage` holds; nothing committed, null where it reads as no bytes. */
export function overRangeAnswer(
	ctx: Pick<CommitContext, 'bytes' | 'reading'>,
	coverage: RangeCoverage,
	gesture: 'place' | { text: string; spend: SpendInsertion | null }
): PlaceAnswer | null {
	const tree = ctx.bytes.doc();
	const read = rangeRead(ctx.bytes, endsOf(coverage), (layout) =>
		removalBytes(tree, coverage, layout)
	);
	if (!read) return null;
	const key = gesture === 'place' ? null : gesture;
	// A key's text runs no paste transform.
	const host = textHost(ctx.reading, read, key?.spend ?? null, (text) => text);
	const asked = key ? { text: key.text } : 'place';
	return { read, answer: editRange(read.source, read.range, asked, modeOf(ctx), host), host };
}

/** The core's place for text over what `coverage` holds: `claimed`, asked by a key's claim, while
 *  the document holds the text it was read on and `coverage` the same bytes, else asked now. */
export function currentPlace(
	ctx: Pick<CommitContext, 'bytes' | 'reading'>,
	coverage: RangeCoverage,
	claimed: PlaceAnswer | null
): PlaceAnswer | null {
	if (claimed?.read.source === ctx.bytes.source()) {
		const { range, layout } = claimed.read;
		const held = removalBytes(ctx.bytes.doc(), coverage, layout);
		if (held?.from === range.from && held.to === range.to) return claimed;
	}
	return overRangeAnswer(ctx, coverage, 'place');
}

/** The host a core answer that writes text reads through, every write of text into a block spent
 *  by `spend`, the step of the block the text lands in; null where no block's step takes it. */
function textHost(
	reading: Reading,
	doc: CurrentDocument,
	spend: SpendInsertion | null,
	transformPaste: PasteHost['transformPaste']
): PasteHost {
	const core = rangeHost(reading, doc);
	return { ...(spend ? spending(core, spend) : core), transformPaste };
}

/** The kind of the block at the core's place for text, whose keymap a line break over the range
 *  runs in: an opened paragraph, or a gap, where Enter opens one, reads as a paragraph. */
export function placeKind({ answer, host }: PlaceAnswer): AnyBlockKind {
	const tree = host.read(answer.source);
	const point = answer.opened ? null : host.layout(tree).leafAt(answer.caret.at);
	return (point && blockNodeAt(tree, point.path)?.kind) || 'paragraph';
}

/** `answer`, the core's paste over `base`, landed in one commit: the block's own write where it
 *  leaves the answer's bytes, else a byte splice. The document must still be `base`. */
async function landAnswer(
	ctx: PasteContext,
	base: string,
	answer: RangeEditResult,
	undo: CommitSnapshotArg
): Promise<boolean> {
	const landed = answer.source;
	const was = ctx.bytes.measured();
	const { leaf } = answer;
	const splice = (history?: UndoGrouping) =>
		commitBytes(ctx, landed, {
			caret: answer.caret,
			op: { kind: 'paste', detail: { count: answer.blocks ?? 0 } },
			snapshot: undo,
			history
		});
	// Text in one block undoes to the caret it began at, as the block's own write records it.
	const asTyped = () =>
		ctx.controller.typingKeystroke(undo.path, undo.offset, undo.path.join(), 'entry', () =>
			splice('join-typing')
		);
	const commit = !leaf
		? () => splice()
		: ctx.pasteCoordinator.landsAsWritten(leaf.path, leaf.raw)
			? () => writeLeaf(ctx, leaf, undo)
			: asTyped;
	// The caret is held past the check: where it lands can set off a write of the block's own (a
	// bare fence given its body line, an emptied heading's marker dropped), which is no paste's.
	const [wrote, landing] = await ctx.controller.holdLandings(commit);
	if (wrote) {
		const { grammar } = ctx.reading;
		assertPasteLanded(
			() => splicedBytes(was, base, landed, grammar),
			() => ctx.bytes.source()
		);
	}
	await landing?.place();
	return wrote;
}

/** `place`, or the last cut's own caret where the clipboard carries the entry that cut wrote, which
 *  fits only there; a plain paste declines the entry, so it goes where the caret is. */
function puttingBack(place: PastePlace, clip: PastedClip, source: string): PastePlace {
	const { back, ...rest } = place;
	if (!back || clip.plain || clip.own === undefined) return rest;
	if (!restored(source, back.at, back.at, clip.own)) return rest;
	const { at, ...held } = back;
	return { ...held, range: { from: at, to: at }, ending: rest.ending };
}

/** The selection ended as a caret at byte `at`, with nothing written. */
async function endRangeAt(ctx: PasteContext, at: number): Promise<void> {
	const point = pointAtByte(ctx.bytes.measured(), at);
	ctx.selection.collapse();
	if (point) await ctx.caretLanding.restore({ anchor: point, focus: point });
}

/** `host` with every write of text into a block spent as an insertion, the text a cut joins to the
 *  first half too: only the core knows whether a paste lands as text, so it spends where it writes. */
function spending(host: RangeHost, spend: SpendInsertion): RangeHost {
	// Spending uses the records up, and the core may land the clipboard twice (a last line ending
	// tried as Enter), so each write is spent once and its answer kept.
	const answers = new Map<string, TextEdit>();
	const once = (before: string, edit: TextEdit) => {
		const key = JSON.stringify([before, edit.text, edit.caretAfter]);
		if (!answers.has(key)) answers.set(key, spend(before, edit));
		return answers.get(key)!;
	};
	const spent = (doc: DocumentView, path: readonly number[], write: LeafWrite): LeafWrite => {
		const before = trimTrailingLineEnding(blockNodeAt(doc, path)!.raw);
		const ending = ownTrailingLineEnding(write.bytes);
		const text = trimTrailingLineEnding(write.bytes);
		const edit = once(before, { text, caretAfter: write.caret });
		const grown = edit.text.length - text.length;
		return { bytes: edit.text + ending, caret: edit.caretAfter, after: write.after + grown };
	};
	const insert: RangeHost['leaf']['insert'] = (doc, path, at, text, mode) =>
		spent(doc, path, host.leaf.insert(doc, path, at, text, mode));
	const replace: RangeHost['leaf']['replace'] = (doc, path, from, to, text, mode) =>
		spent(doc, path, host.leaf.replace(doc, path, from, to, text, mode));
	return {
		...host,
		leaf: {
			...host.leaf,
			insert,
			replace,
			cut(doc, path, from, to, joined, mode) {
				if (joined.before === '') return host.leaf.cut(doc, path, from, to, joined, mode);
				const { before } = joined;
				const plain =
					from === to
						? host.leaf.insert(doc, path, from, before, mode)
						: host.leaf.replace(doc, path, from, to, before, mode);
				const own = spent(doc, path, plain);
				if (own.bytes === plain.bytes) return host.leaf.cut(doc, path, from, to, joined, mode);
				// The records moved or marked the text: the block is cut where they left its caret.
				const written = withLeafBytes(doc, path, own.bytes);
				return host.leaf.cut(written, path, own.caret, own.caret, { ...joined, before: '' }, mode);
			}
		}
	};
}

/** The paste as the block's own write of its finished bytes, an undo entry of its own. */
async function writeLeaf(
	ctx: PasteContext,
	leaf: LeafEdit,
	undo: CommitSnapshotArg
): Promise<boolean> {
	// The write takes bytes worked out off the kept record with no compare of its own, so the record
	// must still hold the block's bytes, as a splice's reading must.
	const [top] = leaf.path;
	if (!ctx.bytes.vouch(top, top)) return false;
	const path = docPathFrom([...leaf.path]);
	const before = undo.path.join() === path.join() ? undo.offset : leaf.caret;
	ctx.controller.flushDebouncedCheckpoint();
	const write = ctx.pasteCoordinator.writeLeaf(leaf.path, leaf.raw, before, leaf.caret);
	const wrote = await write;
	ctx.controller.flushDebouncedCheckpoint();
	// A write that kept the block in place leaves the caret to its caller.
	if (wrote && write.admitted && write.keepsCaret) {
		const point = { path, offset: write.caret };
		await ctx.caretLanding.restore({ anchor: point, focus: point });
	}
	return wrote;
}
