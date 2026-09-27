/**
 * Rewrite a byte range inside one leaf's raw as a single undo entry. The inline popovers and the
 * inline menus all write their bytes this way, through the content write every keystroke takes, so
 * a splice that fills or empties a blank line keeps the separators a reload reads.
 */

import { docPathFrom } from '../cursor/coordinate-spaces';
import { legalizeWrite, type LegalWrite } from '../tree-operations/content-write';
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
		caretAfter: number
	): Promise<boolean>;
}

export function createInlineRangeCommit(root: EditorRoot): InlineRangeCommit {
	/** The leaf's list and the write the splice makes, or null when there is no leaf or the write
	 *  would store the bytes the leaf already has. */
	function planSplice(
		path: number[],
		start: number,
		end: number,
		bytes: string
	): { scope: CommitScope; index: number; write: LegalWrite | null } | null {
		if (path.length === 0) return null;
		const scope = createPathScope(root, docPathFrom(path.slice(0, -1)));
		const index = path[path.length - 1];
		const leaf = scope?.children()[index];
		if (!scope || !leaf) return null;
		const newRaw = leaf.raw.slice(0, start) + bytes + leaf.raw.slice(end);
		// Compared against the bytes the write would store (G4.28), so a splice a table cell's pipe
		// escaping cancels out adds no undo entry (dismissing an image after a resize).
		const write = legalizeWrite(scope.target(), index, newRaw, 'literal');
		return { scope, index, write: write.text === leaf.raw ? null : write };
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
		caretAfter: number
	): Promise<boolean> {
		const plan = planSplice(path, start, end, bytes);
		if (!plan) return false;
		if (!plan.write) return true;
		const landed = await commitLeafText(plan.scope, plan.index, plan.write, {
			snapshotOffset: caretAfter,
			caret: plan.write.storedOffset(caretAfter)
		});
		return landed.wrote;
	}

	return { writtenDelta, commitInlineRange };
}
