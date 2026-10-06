/**
 * What the caret memory keeps for the next insertion: a key that writes nothing until something
 * is inserted after it, such as Shift+Enter at a block's end. Every insertion route takes these
 * records through `CaretMemory.holdInsertion` and spends them on its own write, so a new record
 * joins every route at once; anything that isn't an insertion there ends them.
 */

import type { EdgeAffinity } from './edge-affinity';

/** A block's displayed text after an edit, and where the caret goes in it. */
export interface TextEdit {
	text: string;
	caretAfter: number;
}

/** One kind of record, as the caret memory holds it. */
export interface InsertionRecord {
	/** Read and clear the record left in `block`; null when none is left there. */
	take(block: object): InsertionSpend | null;
	/** Drop the record, wherever it was left. */
	end(): void;
}

/** A record taken for one write. */
export interface InsertionSpend {
	/** The offset an insertion has to land at to spend the record. */
	readonly at: number;
	/** `edit` with the record's bytes in it when it inserts at `at` in `before`, else null. */
	apply(before: string, edit: TextEdit): TextEdit | null;
	/** Put the record back unspent. */
	restore(): void;
}

/** Every record left in one block, taken together for one write. */
export interface HeldInsertion {
	/** The caret's side as the records were taken, for a route that forgets the memory first. */
	readonly side: EdgeAffinity | null;
	/** Whether a record waits for an insertion at `offset`. */
	waitsAt(offset: number): boolean;
	/** `edit` with each record's bytes in it; a record the edit doesn't insert at is dropped. */
	spend(before: string, edit: TextEdit): TextEdit;
	/** Put every record back unspent. */
	restore(): void;
}

export function holdInsertion(
	records: readonly InsertionRecord[],
	block: object,
	side: EdgeAffinity | null
): HeldInsertion {
	const taken = records.flatMap((record) => record.take(block) ?? []);
	return {
		side,
		waitsAt: (offset) => taken.some((spend) => spend.at === offset),
		spend: (before, edit) =>
			taken.reduce((spent, spend) => spend.apply(before, spent) ?? spent, edit),
		restore: () => {
			for (const spend of taken) spend.restore();
		}
	};
}

/** Whether `after` is `before` with text inserted at `at` and nothing else changed. */
export function insertsAt(before: string, after: string, at: number): boolean {
	return (
		after.length > before.length &&
		after.startsWith(before.slice(0, at)) &&
		after.endsWith(before.slice(at))
	);
}
