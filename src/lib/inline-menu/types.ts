/**
 * Inline menus: a list the editor opens under the caret while the author types after a trigger,
 * `#` for a tag or `[[` for a link. The editor owns what a host cannot do from outside without
 * racing it: spotting the trigger as it is typed, holding the navigation keys while the list is
 * up, and replacing the typed range with the pick as one undo entry. A source supplies the rest.
 */

import type { Component } from 'svelte';
import type { MenuIconName } from '../menu-icons';
import type { InsertMarkdownOptions } from '../editor-props';

export interface InlineMenuItem {
	/** The row's key, unique within one result list. Where two rows share one, the first is kept
	 *  and the rest are dropped and reported on the `error` event. */
	id: string;
	label: string;
	/** Secondary text painted dim beside the label: a path, a count. */
	detail?: string;
	/** A menu glyph drawn before the label by the default row. */
	icon?: MenuIconName;
	/** The bytes that replace the trigger and the query, the caret after them. One line: a line break
	 *  is refused and reported, and a block-level insert is `onCommit`'s job. Empty is legal. */
	insert: string;
}

export interface InlineMenuQuery {
	/** What the author typed after the trigger, up to the caret. */
	query: string;
	/** The leaf the session lives in. */
	path: readonly number[];
	/** The raw range a pick replaces: the trigger's first byte to the caret. */
	start: number;
	end: number;
	/** Aborted once a later keystroke supersedes this read, or the menu closes. */
	signal: AbortSignal;
}

/** What `onCommit` gets: the range the pick replaced, and a way to write that belongs to the pick. */
export interface InlineMenuCommit extends Omit<InlineMenuQuery, 'signal'> {
	/** Aborted when the host loads another document before the commit is done. */
	signal: AbortSignal;
	/** `EditorContext.insertMarkdown` for this pick: false, nothing written, once the host has
	 *  loaded another document, so a commit that waits on a fetch can't land in the next one. */
	insertMarkdown(md: string, options?: InsertMarkdownOptions): Promise<boolean>;
}

export interface InlineMenuRowProps {
	item: InlineMenuItem;
	active: boolean;
	query: string;
}

export interface InlineMenuSource {
	/** Unique per editor; the name `open()` addresses. */
	name: string;
	/**
	 * The typed opener, one line and never empty; `addSource` throws otherwise. Where two sources'
	 * triggers both end at the caret, the longer wins.
	 */
	trigger: string;
	/** Whether a trigger whose first byte is `raw[pos]` opens (absent: anywhere), so a tag can
	 *  decline mid-word and `C#` stays text. `open()` never asks. */
	opensAt?(raw: string, pos: number): boolean;
	/** Whether the session outlives this query. Absent means any query without a line break. */
	accepts?(query: string): boolean;
	/** The list for a query. An empty list hides the menu and releases the keys but keeps the
	 *  session; a rejected promise reads as empty and is reported on the `error` event. */
	items(query: InlineMenuQuery): InlineMenuItem[] | Promise<InlineMenuItem[]>;
	/** Runs after the pick's bytes land, with the caret at `start + insert.length`. Writes made while
	 *  a returned promise is pending join the pick's undo entry; write through `commit.insertMarkdown`. */
	onCommit?(item: InlineMenuItem, commit: InlineMenuCommit): void | Promise<void>;
	/** Paints one row's content in place of the default label and detail. */
	row?: Component<InlineMenuRowProps>;
}

export interface InlineMenuSourceHandle {
	dispose(): void;
}

export interface InlineMenuOpenOptions {
	/** Typed after the trigger, so the list opens already narrowed. */
	query?: string;
}

export interface InlineMenuRegistry {
	addSource(source: InlineMenuSource): InlineMenuSourceHandle;
	/** Types the source's trigger and `options.query` at the caret as one undo entry and opens the
	 *  menu. False, writing nothing, for an unknown name, reading mode, no prose caret, or a newline. */
	open(name: string, options?: InlineMenuOpenOptions): boolean;
	/** Close the open menu, leaving what was typed. */
	close(): void;
	/** True while a list is on screen, which is also while the editor holds the arrow keys, Enter,
	 *  Tab and Escape for it. Getter-backed, live. Change signal: the `menuChange` event. */
	readonly isOpen: boolean;
}
