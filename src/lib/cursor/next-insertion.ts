/**
 * The one step every insertion passes before it is written: the block moves it to the side of a
 * hidden edge the caret means, then the caret memory's records spend it (a key that wrote nothing
 * until something is inserted after it, such as Shift+Enter at a block's end). Every route holds
 * the records through `CaretMemory.holdInsertion` and spends them on its own write, so a new record
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

/** An insertion moved across a hidden edge, and the constructs whose marker runs it crossed. */
export interface PlacedEdit extends TextEdit {
	crossed: readonly string[];
}

/** Moves `edit`, an insertion at `at` in `before`, to the offset `side` means at a hidden edge;
 *  null leaves it where it is. `caret` is where the caret said it was typed, which the browser can
 *  put on the other side of a hidden run. A block that draws every marker has none. */
export type PlaceInsertion = (
	before: string,
	edit: TextEdit,
	at: number,
	side: EdgeAffinity | null,
	caret?: number
) => PlacedEdit | null;

/** The block's move of an insertion with the side the records were held at, for a record that
 *  moves bytes across a hidden edge itself. */
export interface Placement {
	place: PlaceInsertion;
	side: EdgeAffinity | null;
}

/** One kind of record. It never asks whether a write holds it: `createInsertionRecords` does. */
export interface InsertionRecord {
	/** The record left in `block`, for one write to spend; null when none waits there. */
	take(block: object): InsertionSpend | null;
	/** Drop the record, or only the one left in `block` when a block is named. */
	end(block?: object): void;
}

/** A record held for one write. */
export interface InsertionSpend {
	/** The offset an insertion has to land at to spend the record. */
	readonly at: number;
	/** `edit` with the record's bytes in it when it inserts at `at` in `before`, else null.
	 *  `placement` is null where the block draws every marker. */
	apply(before: string, edit: TextEdit, placement: Placement | null): SpentEdit | null;
	/** The hold let go: `waiting` leaves the record for the next insertion, otherwise it ends. */
	release(waiting: boolean): void;
}

/** Every record left in one block, held together for one write. */
export interface HeldInsertion {
	/** The caret's side as the records were held, for a route that forgets the memory first. */
	readonly side: EdgeAffinity | null;
	/** Whether a record waits for an insertion at `offset`. */
	waitsAt(offset: number): boolean;
	/** `edit` moved to the side the caret means, unless a record waits where it inserts, then
	 *  `spendInPlace`. */
	spend(before: string, edit: TextEdit, caret?: number): TextEdit;
	/** `edit` with each record's bytes in it, for a write that put its bytes where the caret means
	 *  itself (the auto-pair), so no record moves them; a record the edit doesn't insert at ends. */
	spendInPlace(before: string, edit: TextEdit): TextEdit;
	/** Once, after the write: a record `spend` kept waits on, and so does every record when the
	 *  write `changed` nothing; the rest end. */
	finish(changed: boolean): void;
}

/** The caret memory's records, and which of them a write holds right now. */
export interface InsertionRecords {
	hold(block: object, side: EdgeAffinity | null, place?: PlaceInsertion): HeldInsertion;
	/** Ends `record` (every record when omitted), in `block` when one is named. A record a write
	 *  holds stays in effect, drawn and spendable, until that hold lets go of it. */
	end(record?: InsertionRecord, block?: object): void;
}

export function createInsertionRecords(records: readonly InsertionRecord[]): InsertionRecords {
	const holding = new Set<InsertionRecord>();

	function hold(block: object, side: EdgeAffinity | null, place?: PlaceInsertion): HeldInsertion {
		const held = records.flatMap((record) => {
			const spend = holding.has(record) ? null : record.take(block);
			if (!spend) return [];
			holding.add(record);
			return [{ record, spend, state: 'held' as 'held' | 'kept' | 'done' }];
		});
		const release = (h: (typeof held)[number], waiting: boolean) => {
			holding.delete(h.record);
			h.spend.release(waiting);
			h.state = 'done';
		};
		const waitsAt = (offset: number) =>
			held.some((h) => h.state === 'held' && h.spend.at === offset);
		const spendAll = (before: string, edit: TextEdit, placement: Placement | null): TextEdit => {
			let out = edit;
			for (const h of held) {
				if (h.state !== 'held') continue;
				const spent = h.spend.apply(before, out, placement);
				if (spent?.kept) h.state = 'kept';
				else release(h, false);
				if (spent) out = { text: spent.text, caretAfter: spent.caretAfter };
			}
			return out;
		};
		return {
			side,
			waitsAt,
			spend: (before, edit, caret) => {
				const at = insertionStart(before, edit);
				// A record waiting where the text goes in is what that insertion was for.
				const placed = place && at !== null && !waitsAt(at) && place(before, edit, at, side, caret);
				return spendAll(before, placed || edit, place ? { place, side } : null);
			},
			spendInPlace: (before, edit) => spendAll(before, edit, null),
			finish: (changed) => {
				for (const h of held) if (h.state !== 'done') release(h, h.state === 'kept' || !changed);
			}
		};
	}

	return {
		hold,
		end: (record, block) => {
			for (const each of record ? [record] : records) {
				if (!holding.has(each)) each.end(block);
			}
		}
	};
}

/** Where `edit` put its text into `before`, read off the caret it leaves after that text; null
 *  when the edit is anything but one insertion. */
export function insertionStart(before: string, edit: TextEdit): number | null {
	const at = edit.caretAfter - (edit.text.length - before.length);
	return insertsAt(before, edit.text, at) ? at : null;
}

/** Whether `after` is `before` with text inserted at `at` and nothing else changed. */
export function insertsAt(before: string, after: string, at: number): boolean {
	return (
		after.length > before.length &&
		after.startsWith(before.slice(0, at)) &&
		after.endsWith(before.slice(at))
	);
}
