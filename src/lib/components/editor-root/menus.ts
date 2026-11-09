/**
 * Editor-root menus: the block context menu (a right-click on a block runs its kind's registered
 * actions; prose and a selection get the clipboard rows, the plugins' selection action rows, and
 * prose an insert flyout; over a link or a widget that goes somewhere, an "Edit link" row first).
 * The open menu is `$state` in `Editor.svelte`, written through `setMenu`; a menu takes no focus,
 * so the caret it acts on stays exactly where it is.
 */

import type { BlockEditActions } from '../../action-contracts';
import { BLOCK_ACTIONS_LABEL } from '../../a11y-strings';
import type { NodeView } from '../../core/node-views';
import type { DocumentGetter } from '../../editor-keys';
import type { InsertMarkdownOptions } from '../../editor-props';
import type { PresentationMode } from '../../presentation-mode';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { Draft, DraftSpec } from '../../schema/drafts';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import { rowMarkdown, type InsertRow } from '../../schema/insert-catalogue';
import type { MenuEntry } from '../menu/BlockMenu.svelte';
import {
	runClipboardAction,
	type ClipboardAction,
	type MenuClipboard
} from '../menu/clipboard-actions';
import {
	blockActionsFor,
	blockNoun,
	type BlockActionContext,
	type BlockContextAction
} from '../menu/default-context-actions';
import { isProseLeaf } from '../../schema/page-role';
import type { Reading } from '../../schema/reading';
import { readBlockPath } from '../../selection/path-lookup';
import { holdsSelection, selectionCoversPoint } from '../../selection/held-selection';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { documentLineEnding } from '../../core/lines';
import { stampWrites, type DocumentStamps } from '../../editor-actions/commit/document-stamp';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkMenuOverSelection } from '../../invariants/menu-over-selection';
import type { ActionGroup, ActionRows, SelectionActions } from './selection-actions';

export interface BlockMenuModel {
	x: number;
	y: number;
	anchor: () => { x: number; y: number };
	items: MenuEntry[];
	label: string;
	pick: (id: string) => void;
	/** Called once when the menu closes or another replaces it; a redraw of the same menu keeps it. */
	closed?: () => void;
	/** Told as the pointer comes onto the menu (true) and leaves it (false). */
	pointer?: (inside: boolean) => void;
}

export interface RootMenusDeps {
	/** Getters, never values: the root binds after construction and the mode moves. */
	get editorEl(): HTMLElement | undefined;
	get mode(): PresentationMode;
	getDoc: DocumentGetter;
	isHostChrome(node: Node | null): boolean;
	blockEdit: Pick<BlockEditActions, 'deleteBlock' | 'replaceRaw'>;
	/** A draft watching the block at `path`, which a write from anywhere else marks stale. */
	openDraft(spec: DraftSpec, path: readonly number[]): Draft;
	/** The caret the menu opens over: where the right-click's press pointed, so a right-click on
	 *  prose acts at the pointer; the event's point when no press opened the menu. */
	placeMenuCaret(x: number, y: number): boolean;
	/** Whether the right button's press landed on the user's selection, which picks the menu. */
	rangeAtContextPress(): boolean;
	/** The editor's selection, which the clipboard rows act on before the browser's. */
	selection: Pick<SelectionState, 'ownsRange' | 'widget' | 'isCustomRendered'>;
	/** Whether the last press was a finger's (`selection/pointer-gesture.ts`), whose long press
	 *  the editor takes over, its toolbar the one menu over the word. */
	finger(): boolean;
	/** The public insert entry point; a flyout row inserts `below` the block the caret is in. */
	insertMarkdown(md: string, options?: InsertMarkdownOptions): Promise<boolean>;
	/** What the clipboard rows cut, copy and paste through. */
	clipboard: MenuClipboard;
	/** The insert rows this editor lists, read fresh per menu. */
	inserts(): readonly InsertRow[];
	/** The plugins this editor lists, whose paste transforms the menu applies. */
	activation: PluginActivation;
	/** The editor's reading, which tells a paragraph of pictures from prose. */
	reading: Reading;
	/** A block menu's writes are stamped with the document it opened over. */
	stamps: DocumentStamps;
	/** Whether Mod+K at the caret would edit something, and doing it: the "Edit link" row. */
	canEditLinkAtCaret(): boolean;
	editLinkAtCaret(): void;
	setMenu(menu: BlockMenuModel | null): void;
	/** The open menu, which a late redraw or close checks is still its own. */
	currentMenu(): BlockMenuModel | null;
	/** The plugins' selection actions, whose rows join the clipboard menu. */
	actions: SelectionActions;
}

export interface RootMenus {
	onRootContextMenu(event: MouseEvent): void;
	/** Opens the editor's menu with one action's rows at `point`, following `anchorEl` through a
	 *  scroll; the handle reads whether it's still open. */
	openGroup(
		group: ActionGroup,
		point: Point,
		anchorEl: Element,
		pointer?: (inside: boolean) => void
	): OpenRows;
}

/** What `openRows` hands back. */
export interface OpenRows {
	readonly isOpen: boolean;
	close(): void;
}

const EDIT_LINK = 'link.edit';

const isBlockHost = (node: EventTarget): node is HTMLElement =>
	node instanceof HTMLElement && node.matches('.block-host[data-block-path]');

/** The block a right-click opens its menu for, read off the event's path; null where no menu
 *  opens: outside every block, on the host's own content, or on one of the editor's menus. */
export function menuHostOf(
	e: Event,
	isHostChrome: (node: Node | null) => boolean
): HTMLElement | null {
	const target = e.target instanceof Element ? e.target : null;
	if (!target || isHostChrome(target) || target.closest('.md-menu')) return null;
	return e.composedPath().find(isBlockHost) ?? null;
}

interface Point {
	x: number;
	y: number;
}

export function createRootMenus(deps: RootMenusDeps): RootMenus {
	function anchorOn(el: Element, point: Point): () => Point {
		const rect = el.getBoundingClientRect();
		const dx = point.x - rect.left;
		const dy = point.y - rect.top;
		return () => {
			const now = el.getBoundingClientRect();
			return { x: now.left + dx, y: now.top + dy };
		};
	}

	function clipboardRows(root: HTMLElement): MenuEntry[] {
		const selected = holdsSelection(deps.selection, root);
		return [
			{ id: 'clip.cut', label: 'Cut', icon: 'scissors', disabled: !selected },
			{ id: 'clip.copy', label: 'Copy', icon: 'copy', disabled: !selected },
			{ id: 'clip.paste', label: 'Paste', icon: 'clipboard' },
			{ id: 'clip.paste-plain', label: 'Paste as plain text', icon: 'type' }
		];
	}

	function runClipboardRow(id: string): boolean {
		if (!id.startsWith('clip.')) return false;
		void runClipboardAction(id.slice('clip.'.length) as ClipboardAction, deps.clipboard);
		return true;
	}

	/** Shows `build`'s entries, redrawn as late action rows land; `pick` runs the rows that aren't
	 *  actions'. */
	function showMenu(
		point: Point,
		anchor: () => Point,
		groups: readonly ActionGroup[],
		label: string,
		build: (rows: ActionRows) => MenuEntry[],
		pick: (id: string) => void,
		pointer?: (inside: boolean) => void
	): OpenRows {
		let model: BlockMenuModel | null = null;
		const ours = () => model !== null && deps.currentMenu()?.closed === model.closed;
		const close = () => void (ours() && deps.setMenu(null));
		const redraw = () => void (ours() && deps.setMenu({ ...model!, items: build(rows) }));
		const rows = deps.actions.rows(groups, redraw, close);
		model = {
			...point,
			anchor,
			items: build(rows),
			label,
			pick: (id) => {
				if (rows.pick(id)) return;
				deps.setMenu(null);
				pick(id);
			},
			closed: rows.closed,
			pointer
		};
		deps.setMenu(model);
		return {
			get isOpen() {
				return ours();
			},
			close
		};
	}

	function openGroup(
		group: ActionGroup,
		point: Point,
		anchorEl: Element,
		pointer?: (inside: boolean) => void
	): OpenRows {
		return showMenu(
			point,
			anchorOn(anchorEl, point),
			[group],
			group.action.label,
			(rows) => rows.entries(),
			() => {},
			pointer
		);
	}

	/** `withInsert` adds the "Insert block" flyout, whose rows land below the block the caret was
	 *  just placed in; false leaves the menu to the clipboard rows alone. */
	function openClipboardMenu(
		root: HTMLElement,
		point: Point,
		anchorEl: Element,
		withInsert: boolean
	): void {
		const rows = deps.inserts();
		const editLink: MenuEntry[] = deps.canEditLinkAtCaret()
			? [
					{ id: EDIT_LINK, label: 'Edit link', icon: 'link' },
					{ id: 'sep-edit', label: '', divider: true }
				]
			: [];
		const insert: MenuEntry[] = !withInsert
			? []
			: [
					{ id: 'sep', label: '', divider: true },
					{
						id: 'insert',
						label: 'Insert block',
						icon: 'plus',
						children: rows.map(({ id, label, icon }) => ({ id, label, icon }))
					}
				];
		const divided = (entries: MenuEntry[], at: 'before' | 'after'): MenuEntry[] => {
			if (entries.length === 0) return [];
			const divider = { id: `sep-act-${at}`, label: '', divider: true };
			return at === 'before' ? [divider, ...entries] : [...entries, divider];
		};
		const build = (actions: ActionRows): MenuEntry[] => [
			...divided(actions.entries(true), 'after'),
			...editLink,
			...clipboardRows(root),
			...divided(actions.entries(false), 'before'),
			...insert
		];
		const anchor = anchorOn(anchorEl, point);
		showMenu(point, anchor, deps.actions.atSelection(), BLOCK_ACTIONS_LABEL, build, (id) => {
			if (id === EDIT_LINK) return deps.editLinkAtCaret();
			if (runClipboardRow(id)) return;
			const row = rows.find((r) => r.id === id);
			if (row && withInsert) void deps.insertMarkdown(rowMarkdown(row), { placement: 'below' });
		});
	}

	function openBlockActions(point: Point, host: HTMLElement, path: number[], node: NodeView): void {
		const noun = blockNoun(node, deps.reading);
		const actions = blockActionsFor(node, noun);
		const index = path[0];
		// A row may write after a slow clipboard read; one the block changed under, or a `source`
		// swap outran, writes nothing.
		const contextFor = (draft: Draft, closed: () => boolean): BlockActionContext =>
			stampWrites(
				{
					node,
					path,
					deleteBlock: async () => {
						await deps.blockEdit.deleteBlock(index, 'keyless');
					},
					replaceRaw: async (raw: string) =>
						!closed() && !draft.stale && (await deps.blockEdit.replaceRaw(index, raw)),
					transformPaste: (text) => applyPasteTransforms(text, deps.activation),
					lineEnding: documentLineEnding(deps.getDoc())
				},
				deps.stamps.current(),
				deps.stamps
			);
		deps.setMenu({
			...point,
			anchor: anchorOn(host, point),
			items: actions.map(({ id, label, icon }) => ({ id, label, icon })),
			label: BLOCK_ACTIONS_LABEL,
			pick: (id) => {
				deps.setMenu(null);
				const action = actions.find((a: BlockContextAction) => a.id === id);
				if (!action) return;
				// Opened at the pick, so an edit to the block before the row writes refuses it.
				let closed = false;
				const draft = deps.openDraft({ close: () => (closed = true) }, path);
				const run = action.run(contextFor(draft, () => closed));
				void Promise.resolve(run).finally(() => draft.end());
			}
		});
	}

	// A right-click on a block opens its own menu; prose and a selection get the clipboard rows,
	// and the margin shows nothing.
	function onRootContextMenu(e: MouseEvent): void {
		const root = deps.editorEl;
		if (e.defaultPrevented || deps.mode === 'reading' || !root) return;
		const target = e.target instanceof Element ? e.target : null;
		if (!target || deps.isHostChrome(target)) return;
		// Cancelled for a finger too, or the phone's own menu shows beside the toolbar.
		e.preventDefault();
		if (deps.finger()) return;
		// Off the event's path, fixed at dispatch: the caret placed for the menu may have shown a
		// widget's source, which takes the target out of the page.
		const host = menuHostOf(e, deps.isHostChrome);
		const path = readBlockPath(host);
		if (!host || !path) return;
		const point = { x: e.clientX, y: e.clientY };
		const selected = deps.rangeAtContextPress();
		assertInvariant('menu-over-selection', () =>
			checkMenuOverSelection(selected, holdsSelection(deps.selection, root))
		);
		// A nested block (a fence inside a list item) gets the clipboard rows.
		const node = path.length === 1 ? deps.getDoc().children[path[0]] : undefined;
		const prose = !!node && isProseLeaf(node, deps.reading);
		// What Safari selected under the pointer stays for the clipboard rows to act on, as a native
		// right-click's does; anything else, and anything under a block's actions, the caret replaces.
		if (selected || !node || prose) {
			if (!selected && !selectionCoversPoint(deps.selection, root, e.clientX, e.clientY)) {
				deps.placeMenuCaret(e.clientX, e.clientY);
			}
			// Top-level prose is where a sibling block makes sense.
			openClipboardMenu(root, point, host, !selected && prose);
			return;
		}
		if (holdsSelection(deps.selection, root)) deps.placeMenuCaret(e.clientX, e.clientY);
		openBlockActions(point, host, path, node);
	}

	return { onRootContextMenu, openGroup };
}
