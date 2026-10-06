/**
 * What the caret memory keeps for the next insertion: a key that writes nothing until something
 * is inserted after it, such as Shift+Enter at a block's end. Every insertion route holds these
 * records through `CaretMemory.holdInsertion` and spends them on its own write, so a new record
 * joins every route at once; anything that isn't an insertion there ends them.
 */

import type { EdgeAffinity } from './edge-affinity';

/** A block's displayed text after an edit, and where the caret goes in it. */
export interface TextEdit {
	text: string;
	caretAfter: number;
}

/** A record's answer to an insertion it applies to. */
export interface SpentEdit extends TextEdit {
	/** The record waits on for the next insertion too, as one the insertion extended. */
	kept?: boolean;
}

/** One kind of record, as the caret memory holds it. */
export interface InsertionRecord {
	/** Hold the record left in `block` for one write; null when none waits there. A held record
	 *  stays in effect (drawn, and deaf to `end`) until its hold lets go of it. */
	take(block: object): InsertionSpend | null;
	/** Drop the record unless a write holds it. */
	end(): void;
}

/** A record held for one write. */
export interface InsertionSpend {
	/** The offset an insertion has to land at to spend the record. */
	readonly at: number;
	/** `edit` with the record's bytes in it when it inserts at `at` in `before`, else null. */
	apply(before: string, edit: TextEdit): SpentEdit | null;
	/** Let go: `waiting` leaves the record for the next insertion, otherwise it ends. */
	release(waiting: boolean): void;
}

/** Every record left in one block, held together for one write. */
export interface HeldInsertion {
	/** True when nothing was held, so the write has nothing to spend. */
	readonly empty: boolean;
	/** The caret's side as the records were held, for a route that forgets the memory first. */
	readonly side: EdgeAffinity | null;
	/** Whether a record waits for an insertion at `offset`. */
	waitsAt(offset: number): boolean;
	/** `edit` with each record's bytes in it; a record the edit doesn't insert at ends. */
	spend(before: string, edit: TextEdit): TextEdit;
	/** Once, after the write: a record `spend` kept waits on, and so does every record when the
	 *  write `changed` nothing; the rest end. */
	finish(changed: boolean): void;
}

export function holdInsertion(
	records: readonly InsertionRecord[],
	block: object,
	side: EdgeAffinity | null
): HeldInsertion {
	const held = records.flatMap((record) => {
		const spend = record.take(block);
		return spend ? [{ spend, state: 'held' as 'held' | 'kept' | 'done' }] : [];
	});
	return {
		empty: held.length === 0,
		side,
		waitsAt: (offset) => held.some((h) => h.state === 'held' && h.spend.at === offset),
		spend: (before, edit) => {
			let out = edit;
			for (const h of held) {
				if (h.state !== 'held') continue;
				const spent = h.spend.apply(before, out);
				if (spent?.kept) h.state = 'kept';
				else {
					h.spend.release(false);
					h.state = 'done';
				}
				if (spent) out = { text: spent.text, caretAfter: spent.caretAfter };
			}
			return out;
		},
		finish: (changed) => {
			for (const h of held) {
				if (h.state !== 'done') h.spend.release(h.state === 'kept' || !changed);
				h.state = 'done';
			}
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
