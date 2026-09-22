/**
 * Inline menus: a list the editor opens under the caret while the author types after a trigger,
 * `#` for a tag or `[[` for a link to another document. The editor owns everything a host cannot
 * do from outside without racing it: noticing the trigger as the bytes are typed, claiming the
 * navigation keys while the list is up, anchoring to the typed range, and replacing that range
 * with the pick as one undo entry. A source supplies the trigger and the items.
 */

import type { Component } from 'svelte';

export interface InlineMenuItem {
	/** The row's key, unique within one result list. Where two rows share one, the first is kept
	 *  and the rest are dropped and reported on the `error` event. */
	id: string;
	label: string;
	/** Secondary text painted dim beside the label: a path, a count. */
	detail?: string;
	/**
	 * The bytes that replace the trigger and the query, the caret landing after them. One line of
	 * inline bytes: a line break is refused and reported, and a block-level insert is `onCommit`'s
	 * job. Empty is legal, and removes the trigger and the query.
	 */
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
	/**
	 * Whether a trigger whose first byte is `raw[pos]` opens. Absent means anywhere. A tag declines
	 * mid-word so `C#` stays text. Not consulted by `open()`, whose gesture is the author's say-so.
	 */
	opensAt?(raw: string, pos: number): boolean;
	/** Whether the session outlives this query. Absent means any query without a line break. */
	accepts?(query: string): boolean;
	/**
	 * The list for a query. An empty list hides the menu and releases the keys, while the session
	 * stays alive for the next keystroke. A rejected promise reads as an empty list and is
	 * reported on the `error` event.
	 */
	items(query: InlineMenuQuery): InlineMenuItem[] | Promise<InlineMenuItem[]>;
	/** After a pick's bytes have landed. The range is the one the pick replaced, not where the
	 *  bytes now sit: the caret is at `start + insert.length`. */
	onCommit?(item: InlineMenuItem, query: Omit<InlineMenuQuery, 'signal'>): void;
	/** Paints one row's content in place of the default label and detail. */
	row?: Component<InlineMenuRowProps>;
}

export interface InlineMenuSourceHandle {
	dispose(): void;
}

export interface InlineMenuRegistry {
	addSource(source: InlineMenuSource): InlineMenuSourceHandle;
	/**
	 * The entry for a shortcut or a toolbar button: type the source's trigger at the caret, as one
	 * undo entry, and open its menu there. False, and nothing is written, for an unknown name, in
	 * reading mode, and with no collapsed caret in a prose block.
	 */
	open(name: string): boolean;
	/** Close the open menu, leaving what was typed. */
	close(): void;
	/** True while a list is on screen, which is also while the editor holds the arrow keys, Enter,
	 *  Tab and Escape for it. Getter-backed, live. Change signal: the `menuChange` event. */
	readonly isOpen: boolean;
}
