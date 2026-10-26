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
import {
	blockContextActionsFor,
	type BlockActionContext,
	type BlockContextAction
} from '../../schema/context-actions';
import type { PluginActivation } from '../../schema/plugin-activation';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';
import type { InsertEntry } from '../../schema/insert-catalogue';
import type { MenuEntry } from '../menu/BlockMenu.svelte';
import { runClipboardAction, type ClipboardAction } from '../menu/clipboard-actions';
import type { AimedInsert } from './focused-surface';
import { blockNoun } from '../menu/default-context-actions';
import { isProseLeaf } from '../../schema/page-role';
import type { Reading } from '../../schema/reading';
import { readBlockPath } from '../../selection/path-lookup';
import { rangeCoversPoint } from '../../selection/cross-block/pointer';
import { holdsNativeRange, nativeRangeIn } from '../../browser/selection-read';
import { documentLineEnding } from '../../core/lines';
import { stampWrites, type DocumentStamps } from '../../editor-actions/commit/document-stamp';

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
	blockEdit: Pick<BlockEditActions, 'deleteBlock' | 'replaceRaw'>;
	/** The caret the menu opens over: where the right-click's press pointed, so a right-click on
	 *  prose acts at the pointer; the event's point when no press opened the menu. */
	placeMenuCaret(x: number, y: number): boolean;
	/** Whether the right button's press landed on a selected range, which picks the menu. */
	rangeAtContextPress(): boolean;
	/** Whether the editor holds an inline widget selected, which Cut and Copy act on as on a range. */
	holdsWidget(): boolean;
	/** The public insert entry point; a flyout row inserts `below` the block the caret is in. */
	insertMarkdown(md: string, options?: InsertMarkdownOptions): Promise<boolean>;
	/** An insert at the caret aimed at the block focused now, which a Paste row runs once the
	 *  clipboard read lands; null with no block focused. */
	aimInsertAtFocus(): AimedInsert | null;
	/** The insert entries this editor lists, read fresh per menu. */
	insertCatalogue(): readonly InsertEntry[];
	/** The plugins this editor lists, whose block actions and paste transforms the menu offers. */
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

const isBlockHost = (node: EventTarget): node is HTMLElement =>
	node instanceof HTMLElement && node.matches('.block-host[data-block-path]');

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

	/** The editable element holding focus inside the root, whose selection Cut and Copy act on. */
	function focusedEditable(): HTMLElement | null {
		const active = document.activeElement;
		return active instanceof HTMLElement &&
			deps.editorEl?.contains(active) &&
			active.isContentEditable
			? active
			: null;
	}

	function clipboardRows(): MenuEntry[] {
		const selected = deps.holdsWidget() || (!!focusedEditable() && holdsNativeRange());
		return [
			{ id: 'clip.cut', label: 'Cut', icon: 'scissors', disabled: !selected },
			{ id: 'clip.copy', label: 'Copy', icon: 'copy', disabled: !selected },
			{ id: 'clip.paste', label: 'Paste', icon: 'clipboard' },
			{ id: 'clip.paste-plain', label: 'Paste as plain text', icon: 'type' }
		];
	}

	function runClipboardRow(id: string): boolean {
		if (!id.startsWith('clip.')) return false;
		void runClipboardAction(id.slice('clip.'.length) as ClipboardAction, deps.aimInsertAtFocus());
		return true;
	}

	/** `withInsert` adds the "Insert block" flyout, whose rows land below the block the caret was
	 *  just placed in; false leaves the menu to the clipboard rows alone. */
	function openClipboardMenu(point: Point, anchorEl: Element, withInsert: boolean): void {
		const catalogue = deps.insertCatalogue();
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
						children: catalogue.map(({ id, label, icon }) => ({ id, label, icon }))
					}
				];
		deps.setMenu({
			...point,
			anchor: anchorOn(anchorEl, point),
			items: [...editLink, ...clipboardRows(), ...insert],
			label: BLOCK_ACTIONS_LABEL,
			pick: (id) => {
				deps.setMenu(null);
				if (id === EDIT_LINK) return deps.editLinkAtCaret();
				if (runClipboardRow(id)) return;
				const entry = catalogue.find((e) => e.id === id);
				if (entry && withInsert) void deps.insertMarkdown(entry.markdown, { placement: 'below' });
			}
		});
	}

	function openBlockActions(point: Point, host: HTMLElement, path: number[], node: NodeView): void {
		const noun = blockNoun(node, deps.reading);
		const actions = blockContextActionsFor(node, path, deps.activation, noun);
		if (actions.length === 0) return;
		const index = path[0];
		// A row may write after a slow clipboard read; one a `source` swap outran writes nothing.
		const ctx: BlockActionContext = stampWrites(
			{
				node,
				path,
				deleteBlock: async () => {
					await deps.blockEdit.deleteBlock(index, 'keyless');
				},
				replaceRaw: async (raw: string) => {
					await deps.blockEdit.replaceRaw(index, raw);
				},
				transformPaste: (text) => applyPasteTransforms(text, deps.activation),
				lineEnding: documentLineEnding(deps.getDoc())
			},
			deps.stamps.current(),
			deps.stamps
		);
		deps.setMenu({
			...point,
			anchor: anchorOn(host, point),
			items: actions.map(({ id, label, icon, danger }) => ({
				id,
				label,
				icon: icon as MenuEntry['icon'],
				danger
			})),
			label: BLOCK_ACTIONS_LABEL,
			pick: (id) => {
				deps.setMenu(null);
				const action = actions.find((a: BlockContextAction) => a.id === id);
				if (action) void action.run(ctx);
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
		e.preventDefault();
		// The keyboard's contextmenu event (Windows fires it on the ContextMenu key's release)
		// lands on the item the keydown's own menu already focused: that menu is the answer.
		if (target.closest('.md-menu')) return;
		// Read off the event's path, fixed at dispatch: the caret placed for the menu may have shown
		// a widget's source, which takes the target out of the page.
		const host = e.composedPath().find(isBlockHost) ?? null;
		const path = readBlockPath(host);
		if (!host || !path) return;
		const point = { x: e.clientX, y: e.clientY };
		const selected = deps.rangeAtContextPress();
		// A nested block (a fence inside a list item) gets the clipboard rows.
		const node = path.length === 1 ? deps.getDoc().children[path[0]] : undefined;
		const prose = !!node && isProseLeaf(node, deps.reading);
		// What Safari selected under the pointer stays for the clipboard rows to act on, as a native
		// right-click's does; anything else, and anything under a block's actions, the caret replaces.
		if (selected || !node || prose) {
			if (!selected && !rangeCoversPoint(root, e.clientX, e.clientY)) {
				deps.placeMenuCaret(e.clientX, e.clientY);
			}
			// Top-level prose is where a sibling block makes sense.
			openClipboardMenu(point, host, !selected && prose);
			return;
		}
		if (nativeRangeIn(root)) deps.placeMenuCaret(e.clientX, e.clientY);
		openBlockActions(point, host, path, node);
	}

	return { onRootContextMenu };
}
