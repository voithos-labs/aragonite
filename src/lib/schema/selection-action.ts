/**
 * Rows a plugin offers over a range: what the author selected, or a range it captures around the
 * caret (the misspelled word under it). The editor asks for the rows only when a menu over the
 * range opens, and a picked row writes through a draft opened at the pick.
 */
import type { Icon } from '../menu-icons';
import type { Draft } from './drafts';
import type { Editor } from './plugin-unit';

// ── Public API ───────────────────────────────────────────────────────────────

export interface SelectionAction {
	/** The toolbar row's text, and what the right-click group is called. */
	label: string;
	icon?: Icon;
	/** Sits first in the right-click menu, a divider after its rows. */
	lead?: boolean;
	/** The range the rows act on, in document bytes, or null for none; without it, the selection,
	 *  and none at a bare caret. */
	capture?(
		editor: Editor,
		selection: { readonly from: number; readonly to: number }
	): { from: number; to: number } | null;
	/** Asked when a menu over the range opens; a promise shows one pending row until it settles. */
	rows(captured: Captured): readonly ActionRow[] | Promise<readonly ActionRow[]>;
}

export interface ActionRow {
	label: string;
	icon?: Icon;
	disabled?: boolean;
	/** Writes through `draft`, opened when the row is picked. A promise keeps the row pending and
	 *  the menu open; a write after the menu closed is refused as `closed`. */
	run(draft: Draft): void | Promise<unknown>;
}

/** The range an action's rows act on, as the menu opened over it. */
export interface Captured {
	/** The range's bytes. */
	readonly text: string;
	readonly range: { readonly from: number; readonly to: number };
	/** Where the range paints, in viewport coordinates, measured when read; null when it isn't
	 *  drawn or runs from one text block into another. */
	readonly box: DOMRect | null;
	/** False in reading mode, where a row can't write. */
	readonly editable: boolean;
}

/** A selection action a plugin value contributes, with the plugin it came from. */
export interface ContributedAction {
	readonly plugin: string;
	readonly action: SelectionAction;
}
