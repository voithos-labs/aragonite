/**
 * The copy and cut every block and the editor root share. Each kind of selection a surface can
 * copy is one `ClipboardArm`, written where that selection lives; `runClipboardCut` writes its
 * copy before anything awaits, then deletes what that copy read.
 */

import { shownSelectionText } from '../../../browser/selection-read';
import { writeClipboardEvent, type ClipboardWrite } from '../../../browser/clipboard';

/**
 * One kind of selection a surface can copy: its copy says what to write and reads what its
 * removal deletes, so a cut writes exactly what a copy of the same selection writes.
 */
export interface ClipboardArm<Held = unknown> {
	/** What to write and what the removal needs; null when the selection isn't its kind.
	 *  Synchronous: a scripted cut's data closes as its dispatch ends. */
	copy(): ClipboardTake<Held> | null;
	/** Deletes what `copy` wrote, from what it read. Runs after a shown source is hidden. */
	remove(held: Held): void | Promise<void>;
}

/** What a `ClipboardArm`'s copy writes, and what it hands its removal. */
export interface ClipboardTake<Held = unknown> {
	write: ClipboardWrite;
	held: Held;
}

/** The first `ClipboardArm` that takes the selection, with its copy; null when none does. */
export function takeArm(
	arms: readonly ClipboardArm[]
): { arm: ClipboardArm; take: ClipboardTake } | null {
	for (const arm of arms) {
		const take = arm.copy();
		if (take) return { arm, take };
	}
	return null;
}

/** Writes the copy of the first `ClipboardArm` that takes the selection into `e`; null when none
 *  does. */
export function takeCopy(
	e: ClipboardEvent,
	arms: readonly ClipboardArm[]
): { arm: ClipboardArm; held: unknown } | null {
	const taken = takeArm(arms);
	if (taken === null) return null;
	writeClipboardEvent(e, taken.take.write);
	return { arm: taken.arm, held: taken.take.held };
}

/** Prevents the native cut, writes the copy, then waits for a shown source to hide (when
 *  `hideSource` showed one) and removes what the copy read. */
export async function runClipboardCut(
	e: ClipboardEvent,
	arms: readonly ClipboardArm[],
	hideSource?: () => { settled: Promise<void> } | null
): Promise<void> {
	e.preventDefault();
	const taken = takeCopy(e, arms);
	if (taken === null) return;
	await hideSource?.()?.settled;
	await taken.arm.remove(taken.held);
}

/** Writes what the user sees selected: the copy of a selection that takes the shown text rather
 *  than the raw bytes. */
export function writeShownSelection(e: ClipboardEvent): void {
	writeClipboardEvent(e, { text: shownSelectionText() });
}
