/**
 * A list that opens under the caret when its trigger is typed (`/`, `#`, `[[`). A plugin lists it
 * in what it contributes; a pick writes nothing until the plugin commits it through the `MenuPick`,
 * a draft over the trigger and the query, so a pick that waits lands in its own undo step or not at all.
 */
import type { MenuIconName } from '../menu-icons';
import type { Draft, DraftResult } from './drafts';
import type { Editor } from './plugin-unit';

// ── Public API ───────────────────────────────────────────────────────────────

export interface CaretMenu<R> {
	/** Announced to screen readers when the list opens. */
	label: string;
	/** One line, never empty. */
	trigger: string;
	/** Where the trigger opens a list: after a space or at a line's start (the default), only at a
	 *  line's start, or anywhere. Never in code, a table cell or a link's address. */
	where?: 'word-start' | 'line-start' | 'anywhere';
	/** The rows for what was typed after the trigger; an empty list hides the menu. */
	rows(query: string, ctx: { readonly editor: Editor }): readonly R[] | Promise<readonly R[]>;
	/** Fills a row's element; without it the editor draws a row's `label`, `detail` and `icon`. */
	draw?(row: R, el: HTMLElement): void;
	/** Writes the pick through `pick`, now or after a wait. */
	pick(row: R, pick: MenuPick): void | Promise<void>;
}

/** The row shape the editor draws when a menu has no `draw`. */
export interface MenuRow {
	label: string;
	detail?: string;
	icon?: MenuIconName;
}

/** The draft a pick writes through: bound to the trigger and the query, so a late write lands as
 *  its own undo step, or is refused when the author changed those bytes meanwhile. */
export interface MenuPick extends Draft {
	readonly trigger: string;
	readonly query: string;
	/** The trigger and the query, in the document's bytes when the pick was made. */
	readonly range: { readonly from: number; readonly to: number };
	/** Replaces the trigger and the query with one line of inline bytes, the caret after them. */
	write(inline: string): Promise<DraftResult>;
	/** Removes the trigger and the query and inserts blocks the way a paste would: where the line
	 *  holds other text, into a new paragraph below it. */
	insertBlock(markdown: string): Promise<DraftResult>;
}

/** A caret menu a plugin value contributes, with the plugin it came from. */
export interface ContributedMenu {
	readonly plugin: string;
	readonly menu: CaretMenu<unknown>;
}

/** Makes a caret menu, typing its rows. */
export function menu<R>(spec: CaretMenu<R>): CaretMenu<R> {
	return spec;
}

// ── The pick ─────────────────────────────────────────────────────────────────

/** The parts of a draft a pick builds on, with the paste below the caret's block. */
export interface PickDraft extends Draft {
	insertBelow(markdown: string): this;
}

export function createMenuPick(spec: {
	draft: PickDraft;
	trigger: string;
	query: string;
	range: { from: number; to: number };
	/** Whether the line holds text besides the trigger and the query. */
	lineHasText: boolean;
	/** Whether the author's caret still ends the query, where a pasted block goes. */
	caretStays(): boolean;
}): MenuPick {
	const { draft, range } = spec;
	const refused = (reason: 'illegal' | 'moved', message: string): Promise<DraftResult> =>
		Promise.resolve({ ok: false, reason, message });
	const pick: MenuPick = {
		trigger: spec.trigger,
		query: spec.query,
		range,
		get stale() {
			return draft.stale;
		},
		replace(at, text) {
			draft.replace(at, text);
			return pick;
		},
		insert(markdown) {
			draft.insert(markdown);
			return pick;
		},
		commit: (options) => draft.commit(options),
		end: () => draft.end(),
		write(inline) {
			if (/[\r\n]/.test(inline))
				return refused('illegal', 'a pick writes one line of inline bytes');
			return draft.replace(range, inline).commit({ caret: range.from + inline.length });
		},
		insertBlock(markdown) {
			// A paste goes in at the caret, so a caret moved off the query would take the block with it.
			if (!spec.caretStays()) return refused('moved', 'the caret left the query');
			const emptied = draft.replace(range, '');
			return (spec.lineHasText ? emptied.insertBelow(markdown) : emptied.insert(markdown)).commit();
		}
	};
	return pick;
}
