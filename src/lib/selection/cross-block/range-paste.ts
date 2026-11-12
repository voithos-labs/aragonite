/**
 * A paste through the range-edit core: the clipboard over a place read as bytes, and the core's
 * answer landed in one commit. A paste that is one write of one text block commits as that block's
 * own write, the one a typed letter ends in; any other lands as a byte splice. A kind that answers
 * a paste itself (a table cell's grid and slice) goes first. Every paste route ends here, whatever
 * brought the clipboard.
 */

import type { CommitSnapshotArg } from '../../action-contracts';
import type { TextEdit } from '../../caret/next-insertion';
import { docPathFrom } from '../../core/coordinate-spaces';
import { ownTrailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import type { DocumentView } from '../../core/node-views';
import type { DocumentGetter } from '../../editor-keys';
import { editRange } from '../../range-edit/edit-range';
import type { LeafWrite, PasteHost, RangeHost } from '../../range-edit/host';
import type { LeafEdit } from '../../range-edit/leaf-splice';
import type { PluginActivation } from '../../schema/plugin-activation';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { getPasteSurface, type ClipPasteInput } from '../../tree-operations/paste-surfaces';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import type { PasteCommitCoordinator } from '../../tree-operations/paste/paste-deps';
import type { CaretLanding } from '../caret-landing';
import { placeInBlock, type PastePlace } from '../range-bytes';
import { commitBytes, hostOf, modeOf, type CommitContext } from './range-removal';

export type PasteContext = CommitContext & {
	getDoc: DocumentGetter;
	/** The plugins this editor activated, whose paste transforms run where a paste lands as blocks. */
	activePlugins: PluginActivation;
	pasteCoordinator: PasteCommitCoordinator;
	caretLanding: Pick<CaretLanding, 'restore'>;
};

/** What a paste brings: LF text, whether it goes in as plain text, and the editor's own entry
 *  where the clipboard carried one. */
export interface Clip {
	text: string;
	plain: boolean;
	own?: string;
}

/** What the caret memory holds for the block a paste starts in (a pending mark, the side of a
 *  hidden edge), spent on the block's text as a typed letter spends it. */
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
	clip: Clip,
	undo: CommitSnapshotArg,
	spend?: SpendInsertion
): Promise<boolean> {
	if (await answeredAhead(ctx, span.path, clip, null)) return true;
	const live = modeOf(ctx) === 'live';
	const place = placeInBlock(ctx.bytes, span.path, span.start, span.end, live);
	return place ? pasteThroughCore(ctx, place, clip, undo, spend) : false;
}

/** Whether the kind of the text block at `path` answered the paste itself, ahead of the core;
 *  `cells` are the cells of its table the editor holds selected. */
export async function answeredAhead(
	ctx: PasteContext,
	path: readonly number[],
	clip: Clip,
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

/** Pastes `clip` at `place` in one commit, whose undo puts the caret back at `undo`. False where
 *  the paste changed nothing or the commit refused it. */
export function pasteThroughCore(
	ctx: PasteContext,
	place: PastePlace,
	clip: Clip,
	undo: CommitSnapshotArg,
	spend?: SpendInsertion
): Promise<boolean> {
	const source = ctx.bytes.source();
	const core = hostOf(ctx);
	const host: PasteHost = {
		...(spend ? spending(core, spend) : core),
		transformPaste: (text) => applyPasteTransforms(text, ctx.activePlugins)
	};
	const { range, ...held } = place;
	const gesture = { paste: clip.text, plain: clip.plain, own: clip.own, ...held };
	const answer = editRange(source, range, gesture, modeOf(ctx), host);
	if (answer.source === source) return Promise.resolve(false);
	if (answer.leaf) return writeLeaf(ctx, answer.leaf, undo);
	// A block pasted at the document's end lands on its last line, whose line break stays under it.
	const ending = ownTrailingLineEnding(source);
	const kept = ownTrailingLineEnding(answer.source) || !answer.source ? '' : ending;
	return commitBytes(ctx, answer.source + kept, {
		caret: answer.caret,
		op: { kind: 'paste', detail: { count: answer.blocks ?? 0 } },
		snapshot: undo
	});
}

/** `host` with the paste's own write of a block's text spent as an insertion: only the core knows
 *  whether a paste lands as text, so the records are spent where it writes that text. */
function spending(host: RangeHost, spend: SpendInsertion): RangeHost {
	const spent = (doc: DocumentView, path: readonly number[], write: LeafWrite): LeafWrite => {
		const before = trimTrailingLineEnding(blockNodeAt(doc, path)!.raw);
		const ending = ownTrailingLineEnding(write.bytes);
		const text = trimTrailingLineEnding(write.bytes);
		const edit = spend(before, { text, caretAfter: write.caret });
		const grown = edit.text.length - text.length;
		return { bytes: edit.text + ending, caret: edit.caretAfter, after: write.after + grown };
	};
	return {
		...host,
		leaf: {
			...host.leaf,
			insert: (doc, path, at, text, mode) =>
				spent(doc, path, host.leaf.insert(doc, path, at, text, mode)),
			replace: (doc, path, from, to, text, mode) =>
				spent(doc, path, host.leaf.replace(doc, path, from, to, text, mode))
		}
	};
}

/** The paste as the block's own write of its finished bytes, an undo entry of its own. */
async function writeLeaf(
	ctx: PasteContext,
	leaf: LeafEdit,
	undo: CommitSnapshotArg
): Promise<boolean> {
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
