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
	/** `edit` with the record's bytes in it when it inserts at `at` in `before`, else null. */
	apply(before: string, edit: TextEdit): SpentEdit | null;
	/** The hold let go: `waiting` leaves the record for the next insertion, otherwise it ends. */
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

/** The caret memory's records, and which of them a write holds right now. */
export interface InsertionRecords {
	hold(block: object, side: EdgeAffinity | null): HeldInsertion;
	/** Ends `record` (every record when omitted), in `block` when one is named. A record a write
	 *  holds stays in effect, drawn and spendable, until that hold lets go of it. */
	end(record?: InsertionRecord, block?: object): void;
}

export function createInsertionRecords(records: readonly InsertionRecord[]): InsertionRecords {
	const holding = new Set<InsertionRecord>();

	function hold(block: object, side: EdgeAffinity | null): HeldInsertion {
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
					else release(h, false);
					if (spent) out = { text: spent.text, caretAfter: spent.caretAfter };
				}
				return out;
			},
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

/** Whether `after` is `before` with text inserted at `at` and nothing else changed. */
export function insertsAt(before: string, after: string, at: number): boolean {
	return (
		after.length > before.length &&
		after.startsWith(before.slice(0, at)) &&
		after.endsWith(before.slice(at))
	);
}
