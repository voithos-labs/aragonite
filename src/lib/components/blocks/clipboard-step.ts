/**
 * The cut every block and the editor root share. Each kind of selection a surface can copy is one
 * `ClipboardArm`, written where that selection lives; `runClipboardCut` writes its copy's payload
 * before anything awaits, then deletes what that copy read.
 */

/**
 * One kind of selection a surface can copy: its copy writes the payload and reads what its
 * removal deletes, so a cut writes exactly what a copy of the same selection writes.
 */
export interface ClipboardArm<Held = unknown> {
	/** Writes the payload to `e.clipboardData` and returns what the removal needs; null when the
	 *  selection isn't its kind. Synchronous: a scripted cut's data closes as its dispatch ends. */
	copy(e: ClipboardEvent): ClipboardCopy<Held>;
	/** Deletes what `copy` wrote, from what it read. Runs after a shown source is hidden. */
	remove(held: Held): void | Promise<void>;
}

/** What a `ClipboardArm`'s copy hands its removal, or null for a selection of another kind. */
export type ClipboardCopy<Held> = { held: Held } | null;

/** Writes the payload of the first `ClipboardArm` that takes the selection; null when none does. */
export function takeCopy(
	e: ClipboardEvent,
	arms: readonly ClipboardArm[]
): { arm: ClipboardArm; held: unknown } | null {
	for (const arm of arms) {
		const taken = arm.copy(e);
		if (taken) return { arm, held: taken.held };
	}
	return null;
}

/** Prevents the native cut, writes the payload, then waits for a shown source to hide (when
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
