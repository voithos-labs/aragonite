/**
 * Editor-root menus: the block context menu (a right-click on a block runs its kind's registered
 * actions; prose and a selection get the clipboard rows, and prose an insert flyout). The open
 * menu is `$state` in `Editor.svelte`, written through `setMenu`; a menu takes no focus, so
 * the caret it acts on stays exactly where it is.
 */

import type { BlockEditActions } from '../action-contracts';
import { BLOCK_ACTIONS_LABEL } from '../a11y-strings';
import type { NodeView } from '../core/node-views';
import type { DocumentGetter } from '../editor-keys';
import type { PresentationMode } from '../presentation-mode';
import { blockContextActionsFor, type BlockContextAction } from '../schema/context-actions';
import { insertFlyoutEntries, insertSnippets, type MenuEntry } from './menu/BlockMenu.svelte';
import { runClipboardAction, type ClipboardAction } from './menu/clipboard-actions';
import { isProseBackground } from './menu/default-context-actions';

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
	blockEdit: Pick<BlockEditActions, 'deleteBlock' | 'updateBlockContent' | 'insertParagraph'>;
	/** Where a click on empty space puts the caret, so a right-click on prose acts at the
	 *  pointer. */
	placeCaretAtPoint(x: number, y: number): boolean;
	/** The public insert entry point: a snippet goes to the editable that holds focus. */
	insertMarkdown(md: string): boolean;
	setMenu(menu: BlockMenuModel | null): void;
}

export interface RootMenus {
	onRootContextMenu(event: MouseEvent): void;
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

	function pathOf(host: HTMLElement | null): number[] | null {
		const raw = host?.dataset.blockPath;
		if (!raw) return null;
		try {
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number') ? parsed : null;
		} catch {
			return null;
		}
	}

	/** Where a paste goes: whatever editable element holds focus inside the root. */
	function focusedEditable(): HTMLElement | null {
		const active = document.activeElement;
		return active instanceof HTMLElement &&
			deps.editorEl?.contains(active) &&
			active.isContentEditable
			? active
			: null;
	}

	function clipboardRows(): MenuEntry[] {
		const selected = !!focusedEditable() && !(window.getSelection()?.isCollapsed ?? true);
		return [
			{ id: 'clip.cut', label: 'Cut', icon: 'scissors', disabled: !selected },
			{ id: 'clip.copy', label: 'Copy', icon: 'copy', disabled: !selected },
			{ id: 'clip.paste', label: 'Paste', icon: 'clipboard' },
			{ id: 'clip.paste-plain', label: 'Paste as plain text', icon: 'type' }
		];
	}

	function runClipboardRow(id: string): boolean {
		if (!id.startsWith('clip.')) return false;
		void runClipboardAction(id.slice('clip.'.length) as ClipboardAction, focusedEditable());
		return true;
	}

	// Two steps: create the empty paragraph, which puts the caret in it, then hand the snippet to
	// whatever now holds focus, so an inserted block goes through the same paste path.
	async function insertBlockAfter(index: number, md: string): Promise<void> {
		await deps.blockEdit.insertParagraph(index + 1, '');
		deps.insertMarkdown(md);
	}

	/** `insertAfter` names the top-level block an "Insert block" flyout creates an empty sibling
	 *  after; null leaves the menu to the clipboard rows alone. */
	function openClipboardMenu(point: Point, anchorEl: Element, insertAfter: number | null): void {
		const insert: MenuEntry[] =
			insertAfter === null
				? []
				: [
						{ id: 'sep', label: '', divider: true },
						{ id: 'insert', label: 'Insert block', icon: 'plus', children: insertFlyoutEntries() }
					];
		deps.setMenu({
			...point,
			anchor: anchorOn(anchorEl, point),
			items: [...clipboardRows(), ...insert],
			label: BLOCK_ACTIONS_LABEL,
			pick: (id) => {
				deps.setMenu(null);
				if (runClipboardRow(id)) return;
				const md = insertSnippets().get(id);
				if (md && insertAfter !== null) void insertBlockAfter(insertAfter, md);
			}
		});
	}

	function openBlockActions(point: Point, host: HTMLElement, path: number[], node: NodeView): void {
		const actions = blockContextActionsFor(node, path);
		if (actions.length === 0) return;
		const index = path[0];
		const ctx = {
			node,
			path,
			deleteBlock: async () => {
				await deps.blockEdit.deleteBlock(index);
			},
			replaceRaw: async (raw: string) => {
				await deps.blockEdit.updateBlockContent(index, raw);
			}
		};
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

	// A right-click on a block (a fence, an equation, an image) opens that block's context menu.
	// Prose is the page's background and a selection belongs to the host's popover, so both get
	// the clipboard rows; the margin shows nothing at all.
	function onRootContextMenu(e: MouseEvent): void {
		const root = deps.editorEl;
		if (e.defaultPrevented || deps.mode === 'reading' || !root) return;
		const target = e.target instanceof Element ? e.target : null;
		if (!target || deps.isHostChrome(target)) return;
		e.preventDefault();
		// The keyboard's contextmenu event (Windows fires it on the ContextMenu key's release)
		// lands on the item the keydown's own menu already focused: that menu is the answer.
		if (target.closest('.md-menu')) return;
		const host = target.closest<HTMLElement>('.block-host[data-block-path]');
		const path = pathOf(host);
		if (!host || !path) return;
		const point = { x: e.clientX, y: e.clientY };
		const native = window.getSelection();
		const selected = !!native && !native.isCollapsed && root.contains(native.anchorNode);
		// A nested block (a fence inside a list item) takes the clipboard rows for now.
		const node = path.length === 1 ? deps.getDoc().children[path[0]] : undefined;
		if (selected || !node || isProseBackground(node)) {
			if (!selected) deps.placeCaretAtPoint(e.clientX, e.clientY);
			// Top-level prose is where a sibling block makes sense.
			const insertAfter = !selected && node && isProseBackground(node) ? path[0] : null;
			openClipboardMenu(point, host, insertAfter);
			return;
		}
		openBlockActions(point, host, path, node);
	}

	return { onRootContextMenu };
}
