/**
 * The plugin values' selection actions in one editor: one capture for the right-click menu, the
 * toolbar and `openRows`, rows asked only when one of those opens, and a picked row's draft,
 * opened at the pick and closed with its menu.
 */
import { ACTION_ROWS_PENDING } from '../../a11y-strings';
import type { DocumentView } from '../../core/node-views';
import type { InternalDraft } from '../../editor-actions/commit/draft-registry.svelte';
import type { Editor, PluginError } from '../../schema/plugin-unit';
import type {
	ActionRow,
	Captured,
	ContributedAction,
	SelectionAction
} from '../../schema/selection-action';
import { documentByteMap } from '../../tree-operations/container-offsets';
import { isThenable } from '../../schema/editor-contributions';
import type { MenuEntry } from '../menu/BlockMenu.svelte';

/** An action's capture over one range, which its rows are asked about. */
export interface ActionGroup {
	readonly plugin: string;
	readonly action: SelectionAction;
	readonly captured: Captured;
}

/** One open menu's action rows. */
export interface ActionRows {
	/** The rows as menu entries, a pending row where a group's rows are still coming; `lead` keeps
	 *  only the groups that sit first, or only the rest. */
	entries(lead?: boolean): MenuEntry[];
	/** Runs the row an entry id names against a draft opened now; false for an id that isn't one. */
	pick(id: string): boolean;
	/** The menu closed, so a pending row's later write is refused. */
	closed(): void;
}

export interface SelectionActions {
	/** Each action's capture over the selection, in list order. */
	atSelection(): ActionGroup[];
	/** The captures that take a selected range whole, none at a bare caret: the toolbar's rows. */
	wholeSelection(): ActionGroup[];
	/** One action's capture over `range`, or null where it captures nothing. */
	over(action: SelectionAction, range: { from: number; to: number }): ActionGroup | null;
	/** Asks the groups for their rows: `redraw` when late rows land or a picked row waits, `close`
	 *  once a pick is done. A throw or a rejection is reported and reads as no rows. */
	rows(groups: readonly ActionGroup[], redraw: () => void, close: () => void): ActionRows;
}

export function createSelectionActions(deps: {
	actions(): readonly ContributedAction[];
	editorFor(plugin: string): Editor | undefined;
	getDoc(): DocumentView;
	/** The document's bytes, serialized once per content version. */
	source(): string;
	/** The selection in document bytes, null for none or a cell selection. */
	selection(): { from: number; to: number } | null;
	editable(): boolean;
	/** The rects over offsets `start` to `end` of the leaf at `path`. */
	rangeRects(path: number[], start: number, end: number): DOMRect[];
	edit(plugin: string): InternalDraft;
	report(error: PluginError): void;
}): SelectionActions {
	// One leaf's rects joined; a range across leaves has no one box.
	function box(from: number, to: number): DOMRect | null {
		const map = documentByteMap(deps.getDoc());
		const start = map.leafAt(from);
		const end = map.leafAt(to);
		if (!start || !end || start.path.join() !== end.path.join()) return null;
		const [first, ...rest] = deps.rangeRects(start.path, start.offset, end.offset);
		if (!first) return null;
		let { left, top, right, bottom } = first;
		for (const r of rest) {
			left = Math.min(left, r.left);
			top = Math.min(top, r.top);
			right = Math.max(right, r.right);
			bottom = Math.max(bottom, r.bottom);
		}
		return new DOMRect(left, top, right - left, bottom - top);
	}

	function capture(
		{ plugin, action }: ContributedAction,
		over: { from: number; to: number },
		source: string
	): ActionGroup | null {
		const editor = deps.editorFor(plugin);
		if (!editor) return null;
		let range: { from: number; to: number } | null;
		try {
			range = action.capture ? action.capture(editor, over) : over.from < over.to ? over : null;
		} catch (cause) {
			deps.report({ plugin, doing: `capture for '${action.label}'`, cause });
			return null;
		}
		if (!range || !(0 <= range.from && range.from <= range.to && range.to <= source.length))
			return null;
		const { from, to } = range;
		// Measured on read, so a capture the toolbar makes per selection change reads no layout.
		let measured: DOMRect | null | undefined;
		const captured: Captured = Object.freeze({
			text: source.slice(from, to),
			range: Object.freeze({ from, to }),
			get box() {
				return measured === undefined ? (measured = box(from, to)) : measured;
			},
			editable: deps.editable()
		});
		return { plugin, action, captured };
	}

	function report(group: ActionGroup, doing: string, cause: unknown): void {
		deps.report({ plugin: group.plugin, doing: `${doing} '${group.action.label}'`, cause });
	}

	function rowsOf(group: ActionGroup): readonly ActionRow[] | Promise<readonly ActionRow[]> {
		try {
			const rows = group.action.rows(group.captured);
			if (Array.isArray(rows)) return rows;
			return Promise.resolve(rows).then(undefined, (cause: unknown) => {
				report(group, 'rows for', cause);
				return [];
			});
		} catch (cause) {
			report(group, 'rows for', cause);
			return [];
		}
	}

	/** Runs the row against a draft opened now; the draft's `close`, or null once it has settled. */
	function pick(group: ActionGroup, row: ActionRow, settled: () => void): (() => void) | null {
		const draft = deps.edit(group.plugin);
		let ran: unknown;
		try {
			ran = row.run(draft);
		} catch (cause) {
			report(group, 'run', cause);
		}
		if (!isThenable(ran)) {
			draft.end();
			return null;
		}
		void Promise.resolve(ran)
			.then(undefined, (cause: unknown) => report(group, 'run', cause))
			.then(() => (draft.end(), settled()));
		return () => draft.close();
	}

	function rows(groups: readonly ActionGroup[], redraw: () => void, close: () => void): ActionRows {
		const answers = new Map<ActionGroup, readonly ActionRow[] | null>();
		const running = new Set<ActionRow>();
		const pending: (() => void)[] = [];
		for (const group of groups) {
			const asked = rowsOf(group);
			answers.set(group, isThenable(asked) ? null : asked);
			if (isThenable(asked)) void asked.then((late) => (answers.set(group, late), redraw()));
		}
		return {
			entries: (lead) =>
				groups.flatMap((group, g): MenuEntry[] => {
					if (lead !== undefined && !!group.action.lead !== lead) return [];
					const answer = answers.get(group);
					if (answer === null)
						return [
							{
								id: `act:${g}:-`,
								label: group.action.pending ?? ACTION_ROWS_PENDING,
								disabled: true
							}
						];
					return (answer ?? []).map((row, r) => ({
						id: `act:${g}:${r}`,
						label: row.label,
						icon: row.icon,
						disabled: row.disabled || running.has(row)
					}));
				}),
			pick(id) {
				const at = /^act:(\d+):(\d+)$/.exec(id);
				if (!at) return false;
				const group = groups[Number(at[1])];
				const row = answers.get(group)?.[Number(at[2])];
				const closeDraft = row ? pick(group, row, () => (running.delete(row), close())) : null;
				if (!row || !closeDraft) return (close(), true);
				running.add(row);
				pending.push(closeDraft);
				redraw();
				return true;
			},
			closed: () => pending.forEach((closeDraft) => closeDraft())
		};
	}

	function captures(over: { from: number; to: number } | null): ActionGroup[] {
		const entries = deps.actions();
		if (!over || entries.length === 0) return [];
		const source = deps.source();
		return entries.flatMap((entry) => capture(entry, over, source) ?? []);
	}

	return {
		atSelection: () => captures(deps.selection()),
		wholeSelection() {
			const over = deps.selection();
			return over && over.from < over.to
				? captures(over).filter(
						({ captured: { range } }) => range.from === over.from && range.to === over.to
					)
				: [];
		},
		over(action, range) {
			const entry = deps.actions().find((candidate) => candidate.action === action);
			return entry ? capture(entry, range, deps.source()) : null;
		},
		rows
	};
}
