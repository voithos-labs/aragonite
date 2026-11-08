/**
 * The plugin values' selection actions in one editor: one capture for the right-click menu, the
 * toolbar and `openRows`, rows asked only when one of those opens, and a picked row's draft,
 * opened at the pick and closed with its menu.
 */
import type { DocumentView } from '../../core/node-views';
import { serialize } from '../../core/serializer';
import type { InternalDraft } from '../../editor-actions/commit/draft-registry.svelte';
import type { Editor, PluginError } from '../../schema/plugin-unit';
import type {
	ActionRow,
	Captured,
	ContributedAction,
	SelectionAction
} from '../../schema/selection-action';
import type { EditorSelection } from '../../selection/primitives';
import { byteOfLeaf, leafAtByte } from '../../tree-operations/container-offsets';
import { isThenable } from '../../schema/editor-contributions';

/** An action's capture over one range, which its rows are asked about. */
export interface ActionGroup {
	readonly plugin: string;
	readonly action: SelectionAction;
	readonly captured: Captured;
}

/** A picked row whose `run` is still pending: closing its menu refuses what it writes after. */
export interface PendingPick {
	readonly settled: Promise<void>;
	close(): void;
}

export interface SelectionActions {
	/** Each action's capture over the selection, in list order. */
	atSelection(): ActionGroup[];
	/** The selection in document bytes, or null where it isn't in prose. */
	selectionBytes(): { from: number; to: number } | null;
	/** One action's capture over `range`, or null where it captures nothing. */
	over(action: SelectionAction, range: { from: number; to: number }): ActionGroup | null;
	/** The group's rows; a throw or a rejection is reported and reads as none. */
	rows(group: ActionGroup): readonly ActionRow[] | Promise<readonly ActionRow[]>;
	/** Runs the row against a draft opened now; null once it has settled. */
	pick(group: ActionGroup, row: ActionRow): PendingPick | null;
}

export function createSelectionActions(deps: {
	actions(): readonly ContributedAction[];
	editorFor(plugin: string): Editor | undefined;
	getDoc(): DocumentView;
	getSelection(): EditorSelection | null;
	editable(): boolean;
	/** The rects over offsets `start` to `end` of the leaf at `path`. */
	rangeRects(path: number[], start: number, end: number): DOMRect[];
	edit(plugin: string): InternalDraft;
	report(error: PluginError): void;
}): SelectionActions {
	function selectionBytes(): { from: number; to: number } | null {
		const selection = deps.getSelection();
		if (!selection || selection.anchor.cellCoordinate || selection.focus.cellCoordinate)
			return null;
		const doc = deps.getDoc();
		const a = byteOfLeaf(doc, selection.anchor.path, selection.anchor.offset);
		const f = byteOfLeaf(doc, selection.focus.path, selection.focus.offset);
		return a === null || f === null ? null : { from: Math.min(a, f), to: Math.max(a, f) };
	}

	// One leaf's rects joined; a range across leaves has no one box.
	function box({ from, to }: { from: number; to: number }): DOMRect | null {
		const doc = deps.getDoc();
		const start = leafAtByte(doc, from);
		const end = leafAtByte(doc, to);
		if (!start || !end || start.path.join() !== end.path.join()) return null;
		const rects = deps.rangeRects(start.path, start.offset, end.offset);
		if (rects.length === 0) return null;
		const [first, ...rest] = rects;
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
		text: string
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
		if (!range || !(0 <= range.from && range.from <= range.to && range.to <= text.length))
			return null;
		const { from, to } = range;
		const captured: Captured = Object.freeze({
			text: text.slice(from, to),
			range: Object.freeze({ from, to }),
			box: box({ from, to }),
			editable: deps.editable()
		});
		return { plugin, action, captured };
	}

	function report(group: ActionGroup, doing: string, cause: unknown): void {
		deps.report({ plugin: group.plugin, doing: `${doing} '${group.action.label}'`, cause });
	}

	return {
		selectionBytes,
		atSelection() {
			const over = selectionBytes();
			const entries = deps.actions();
			if (!over || entries.length === 0) return [];
			const text = serialize(deps.getDoc());
			return entries.flatMap((entry) => capture(entry, over, text) ?? []);
		},
		over(action, range) {
			const entry = deps.actions().find((candidate) => candidate.action === action);
			return entry ? capture(entry, range, serialize(deps.getDoc())) : null;
		},
		rows(group) {
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
		},
		pick(group, row) {
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
			const settled = Promise.resolve(ran).then(
				() => draft.end(),
				(cause: unknown) => {
					report(group, 'run', cause);
					draft.end();
				}
			);
			return { settled, close: () => draft.close() };
		}
	};
}
