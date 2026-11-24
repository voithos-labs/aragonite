/**
 * A list that opens under the caret when its trigger is typed (`/`, `#`, `[[`). A plugin lists it
 * in what it contributes; a pick writes nothing until the plugin commits it through the `MenuPick`,
 * a draft over the trigger and the query, so a pick that waits lands in its own undo step or not at all.
 */
import type { MenuIconName } from '../menu-icons';
import type { Draft, DraftResult } from './drafts';
import type { Editor } from './plugin-unit';
import type { Command } from './plugin-command';

// ── Public API ───────────────────────────────────────────────────────────────

export interface CaretMenu<R> {
	/** Announced to screen readers when the list opens. */
	label: string;
	/** One line, never empty. */
	trigger: string;
	/** Where the trigger opens a list: after a space or at a line's start (the default), only at a
	 *  line's start, or anywhere. Never in code, a table cell or a link's address. */
	where?: 'word-start' | 'line-start' | 'anywhere';
	/** Whether the list stays open for what was typed after the trigger; without it, any one line does. */
	accepts?(query: string, ctx: { readonly editor: Editor }): boolean;
	/** The rows for what was typed after the trigger; an empty list hides the menu. */
	rows(query: string, ctx: { readonly editor: Editor }): readonly R[] | Promise<readonly R[]>;
	/** Draws a row, as a `PluginView` does; without it the editor draws a row's `label`, `detail`
	 *  and `icon`. */
	view?(
		target: HTMLElement,
		props: MenuRowProps<R>
	): { update?(props: MenuRowProps<R>): void; destroy?(): void | Promise<void> };
	/** Writes the pick through `pick`, now or after a wait. */
	pick(row: R, pick: MenuPick): void | Promise<void>;
}

/** The row shape the editor draws when a menu has no `view`. */
export interface MenuRow {
	/** Keeps the row's name for a screen reader as the query narrows the list; the label otherwise.
	 *  Of two rows sharing one, the first is kept and the rest are reported. */
	id?: string;
	label: string;
	detail?: string;
	icon?: MenuIconName;
}

/** What a menu's row view is given, again as the row turns active or the query changes. */
export interface MenuRowProps<R> {
	row: R;
	active: boolean;
	query: string;
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
	/** Removes the trigger and the query and inserts blocks the way `insertBelow` does: where the
	 *  line holds other text, into a new paragraph below it, else on that line. */
	insertBlock(markdown: string): Promise<DraftResult>;
	/** Removes the trigger and the query, then runs `command` at the caret, as one undo step; false
	 *  when the removal is refused or the command declines. */
	run<A>(command: Command<A, never>, arg: A): Promise<boolean>;
	run(command: Command | string, arg?: unknown): Promise<boolean>;
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

/** The draft a pick builds on, which knows where a byte it opened on sits now. */
export interface PickDraft extends Draft {
	now(at: number): number | null;
}

export function createMenuPick(spec: {
	/** Watches the trigger and the query, so it goes stale when the author changes them. */
	draft: PickDraft;
	trigger: string;
	query: string;
	range: { from: number; to: number };
	/** Takes the trigger and the query out through the editor's own write, wherever byte `at`
	 *  (where they start now) puts them; null when those bytes aren't there any more. */
	removeQuery(at: number | null): Promise<boolean>;
	editor(): Editor | undefined;
	/** Groups the removal and what follows it into one undo step. */
	undoStep(run: () => Promise<unknown>): Promise<void>;
}): MenuPick {
	const { draft, range } = spec;
	const refused = (reason: 'illegal' | 'moved', message: string): DraftResult => ({
		ok: false,
		reason,
		message
	});
	// Set while a removal waits on the editor, so a pick that didn't await it isn't ended under it.
	let removing = false;
	// The removal is the editor's leaf write, which keeps an emptied line one empty paragraph.
	async function removeThen(next: () => Promise<DraftResult>) {
		// A stale draft's own commit says why: the note replaced, or the query changed.
		if (draft.stale) return draft.replace(range, '').commit();
		let result = refused('moved', 'the trigger and the query are gone');
		removing = true;
		try {
			await spec.undoStep(async () => {
				if (await spec.removeQuery(draft.now(range.from))) result = await next();
			});
		} finally {
			removing = false;
			draft.end();
		}
		return result;
	}
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
		insertBelow(markdown) {
			draft.insertBelow(markdown);
			return pick;
		},
		data(block, data) {
			draft.data(block, data);
			return pick;
		},
		body(block, text) {
			draft.body(block, text);
			return pick;
		},
		commit: (options) => draft.commit(options),
		end: () => void (removing || draft.end()),
		write(inline) {
			if (/[\r\n]/.test(inline))
				return Promise.resolve(refused('illegal', 'a pick writes one line of inline bytes'));
			// The range's start as the document stands now, which a write above it has moved.
			const at = draft.replace(range, inline).now(range.from);
			return draft.commit(at === null ? undefined : { caret: at + inline.length });
		},
		insertBlock: (markdown) => removeThen(() => draft.insertBelow(markdown).commit()),
		async run(command: Command<unknown, never> | string, arg?: unknown) {
			const editor = spec.editor();
			if (!editor) return false;
			let ran = false;
			const result = await removeThen(async () => {
				ran = editor.run(command as Command, arg);
				return { ok: true };
			});
			return result.ok && ran;
		}
	};
	return pick;
}
