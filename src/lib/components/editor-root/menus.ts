/**
 * Editor-root menus: the block context menu (a right-click on a block runs its kind's registered
 * actions; prose and a selection get the clipboard rows, and prose an insert flyout; over a link
 * or a widget that goes somewhere, an "Edit link" row first). The open menu is `$state` in
 * `Editor.svelte`, written through `setMenu`; a menu takes no focus, so the caret it acts on
 * stays exactly where it is.
 */

import type { BlockEditActions } from '../../action-contracts';
import { BLOCK_ACTIONS_LABEL } from '../../a11y-strings';
import type { NodeView } from '../../core/node-views';
import type { DocumentGetter } from '../../editor-keys';
import type { InsertMarkdownOptions } from '../../editor-props';
import type { PresentationMode } from '../../presentation-mode';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { Draft, DraftResult } from '../../schema/drafts';
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
import { documentLineEnding, withLineEnding } from '../../core/lines';
import { blockBytes } from '../../editor-actions/commit/change-record';
import { stampWrites, type DocumentStamps } from '../../editor-actions/commit/document-stamp';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkMenuOverSelection } from '../../invariants/menu-over-selection';

export interface BlockMenuModel {
	x: number;
	y: number;
	anchor: () => { x: number; y: number };
	items: MenuEntry[];
	label: string;
	pick: (id: string) => void;
}

export interface RootMenusDeps {
	/** Getters, never values: the root binds after construction and the mode moves. */
	get editorEl(): HTMLElement | undefined;
	get mode(): PresentationMode;
	getDoc: DocumentGetter;
	isHostChrome(node: Node | null): boolean;
	blockEdit: Pick<BlockEditActions, 'deleteBlock'>;
	/** A draft against the document as it is now, which a row's write goes through. */
	edit(): Draft;
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
}

export interface RootMenus {
	onRootContextMenu(event: MouseEvent): void;
}

const EDIT_LINK = 'link.edit';
const NOT_FOUND: DraftResult = { ok: false, reason: 'moved', message: 'the block is gone' };

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
		deps.setMenu({
			...point,
			anchor: anchorOn(anchorEl, point),
			items: [...editLink, ...clipboardRows(root), ...insert],
			label: BLOCK_ACTIONS_LABEL,
			pick: (id) => {
				deps.setMenu(null);
				if (id === EDIT_LINK) return deps.editLinkAtCaret();
				if (runClipboardRow(id)) return;
				const row = rows.find((r) => r.id === id);
				if (row && withInsert) void deps.insertMarkdown(rowMarkdown(row), { placement: 'below' });
			}
		});
	}

	function openBlockActions(point: Point, host: HTMLElement, path: number[], node: NodeView): void {
		const noun = blockNoun(node, deps.reading);
		const actions = blockActionsFor(node, noun);
		const index = path[0];
		// A row may write after a slow clipboard read; one a `source` swap outran writes nothing.
		const contextFor = (draft: Draft): BlockActionContext => {
			const doc = deps.getDoc();
			const lineEnding = documentLineEnding(doc);
			const bytes = blockBytes(doc, path);
			return stampWrites(
				{
					node,
					path,
					deleteBlock: async () => {
						await deps.blockEdit.deleteBlock(index, 'keyless');
					},
					// The caret lands where the block started, at the text it became.
					replaceRaw: (raw: string) =>
						bytes
							? draft.replace(bytes, withLineEnding(raw, lineEnding)).commit({ caret: bytes.from })
							: Promise.resolve(NOT_FOUND),
					transformPaste: (text) => applyPasteTransforms(text, deps.activation),
					lineEnding
				},
				deps.stamps.current(),
				deps.stamps
			);
		};
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
				const draft = deps.edit();
				void Promise.resolve(action.run(contextFor(draft))).finally(() => draft.end());
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

	return { onRootContextMenu };
}
