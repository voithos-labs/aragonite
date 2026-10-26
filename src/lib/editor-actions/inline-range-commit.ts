/**
 * Rewrite a byte range inside one leaf's raw as a single undo entry. The inline popovers and the
 * inline menus all write their bytes this way, through the content write every keystroke takes, so
 * a splice that fills or empties a blank line keeps the separators a reload reads, and a live-mode
 * removal cleans its join as a cut does (`docs/design/live-mode.md` § 4.5).
 */

import { docPathFrom } from '../core/coordinate-spaces';
import { legalizeWrite, type LegalWrite } from '../tree-operations/content-write';
import { replaceRangeInLeaf } from '../tree-operations/leaf-range';
import { storedAsIn } from '../tree-operations/stored-as';
import { createPathScope, type CommitScope } from './block-edit-scope';
import { commitLeafText } from './block-edit-core';
import type { EditorRoot } from './deps';

export interface InlineRangeCommit {
	/**
	 * The length change the same splice would store once the leaf's kind and its container rewrite
	 * it, read before committing; 0 when it would store nothing.
	 */
	writtenDelta(path: number[], start: number, end: number, bytes: string): number;
	/** Splice `bytes` over `[start, end)` of the leaf at `path`; the undo entry restores the caret
	 *  to `caretAfter`. Resolves whether the leaf holds the bytes (true for a no-change splice). */
	commitInlineRange(
		path: number[],
		start: number,
		end: number,
		bytes: string,
		caretAfter: number,
		opts?: InlineRangeOptions
	): Promise<boolean>;
}

export interface InlineRangeOptions {
	/** Put the caret at `caretAfter` too, moved with `bytes` by a cleaned join and by a stored escape
	 *  (a cell's `\|`), and bring it into view: the next key goes to the document. */
	landCaret?: boolean;
}

export function createInlineRangeCommit(root: EditorRoot): InlineRangeCommit {
	/** The leaf's list, the write the splice makes and where `caretAfter` lands in it, or null when
	 *  there is no leaf. `write` is null where it would store the bytes the leaf already has. */
	function planSplice(
		path: number[],
		start: number,
		end: number,
		bytes: string
	): { scope: CommitScope; index: number; write: LegalWrite | null; moved: Moved } | null {
		if (path.length === 0) return null;
		const scope = createPathScope(root, docPathFrom(path.slice(0, -1)));
		const index = path[path.length - 1];
		const leaf = scope?.children()[index];
		if (!scope || !leaf) return null;
		const store = storedAsIn(scope.target(), index, root.deps.reading);
		const edit = replaceRangeInLeaf(leaf, { start, end }, bytes, store);
		const moved = movedBy(start, edit.caret - bytes.length, bytes.length);
		// Compared against the bytes the write would store (G4.28), so a splice a table cell's pipe
		// escaping cancels out adds no undo entry (dismissing an image after a resize).
		const write = legalizeWrite(scope.target(), index, edit.raw, 'literal');
		return { scope, index, write: write.text === leaf.raw ? null : write, moved };
	}

	function writtenDelta(path: number[], start: number, end: number, bytes: string): number {
		const plan = planSplice(path, start, end, bytes);
		if (!plan?.write) return 0;
		return plan.write.text.length - plan.scope.children()[plan.index].raw.length;
	}

	async function commitInlineRange(
		path: number[],
		start: number,
		end: number,
		bytes: string,
		caretAfter: number,
		opts: InlineRangeOptions = {}
	): Promise<boolean> {
		const plan = planSplice(path, start, end, bytes);
		if (!plan) return false;
		// Not held: the height correction already keeps the focused line still.
		const reveal = 'into-view';
		if (!plan.write) {
			if (opts.landCaret) {
				await root.deps.caretLanding.land(plan.scope.at(plan.index, [], caretAfter), { reveal });
			}
			return true;
		}
		const landed = await commitLeafText(plan.scope, plan.index, plan.write, {
			snapshotOffset: caretAfter,
			caret: plan.write.storedOffset(plan.moved(caretAfter)),
			landing: opts.landCaret ? (written) => written.caret : undefined,
			reveal
		});
		return landed.wrote;
	}

	return { writtenDelta, commitInlineRange };
}

/** An offset among the `length` bytes written at `start`, or at either end of them, moved to where
 *  the cleaned join put them; any other offset stays. */
type Moved = (offset: number) => number;

const movedBy =
	(start: number, seam: number, length: number): Moved =>
	(offset) =>
		offset >= start && offset <= start + length ? seam + offset - start : offset;
