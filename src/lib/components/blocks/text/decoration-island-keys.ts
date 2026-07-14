/**
 * Keyboard dispatch for decoration islands sitting against the caret. A decoration
 * island ([data-decoration-island]) is a view-only atomic widget that never enters
 * the CST, so the CST-widget machinery in widget-interaction.ts cannot see it —
 * yet native contenteditable would delete the island element itself on an edge
 * Backspace/Delete. For a replace island that silently drops the hidden bytes its
 * `data-source-*` span stands for (invisible corruption); for a zero-length widget
 * island it eats nothing (a dead keystroke). This owns the caret-edge rules that
 * keep both honest:
 *
 *   - replace island (hidden bytes): the edge press selects it whole; a second
 *     press deletes the entire hidden range through the CST — one edit, one undo
 *     entry (the image-widget select-then-delete precedent).
 *   - widget island (zero bytes): Backspace/Delete act on the adjacent real byte
 *     as if the island weren't there; typing at an element-level boundary inserts
 *     at its offset (Chromium drops printable keys there natively).
 *
 * Islands and the caret offset share the block's raw-content coordinate space
 * (ambient marker excluded, block-own marker included), so the DOM `data-source-*`
 * values compare directly against `caretOffset`.
 */

import type { BlockEditActions } from '../../../action-contracts';
import type { CstNode } from '../../../core/nodes';
import { trimTrailingLineEnding } from '../../../core/lines';
import { recordIslandKeyScan } from '../../../perf/instruments';

interface IslandSpan {
	start: number;
	end: number;
	el: HTMLElement;
}

export interface DecorationIslandKeysDeps {
	get node(): CstNode;
	get index(): number;
	getEl: () => HTMLElement | null;
	/** Anchor/focus raw-content offsets of the live selection, or null when collapsed. */
	getRawSelection: () => { start: number; end: number } | null;
	blockEdit: BlockEditActions;
	setPendingCursor: (offset: number | null) => void;
}

export interface DecorationIslandKeys {
	/** Backspace/Delete/typing while the caret sits against — or a native selection
	 *  wraps — a decoration island. Returns whether the event was consumed. */
	handleKeydown(e: KeyboardEvent, caretOffset: number | null): boolean;
}

export function createDecorationIslandKeys(deps: DecorationIslandKeysDeps): DecorationIslandKeys {
	function islandsInDom(el: HTMLElement): IslandSpan[] {
		recordIslandKeyScan();
		const out: IslandSpan[] = [];
		for (const node of el.querySelectorAll<HTMLElement>('[data-decoration-island]')) {
			const start = Number(node.dataset.sourceStart);
			const end = Number(node.dataset.sourceEnd);
			if (Number.isInteger(start) && Number.isInteger(end)) out.push({ start, end, el: node });
		}
		return out;
	}

	function display(): string {
		return trimTrailingLineEnding(deps.node.raw);
	}

	function editDisplay(start: number, end: number, insert: string): void {
		const d = display();
		const next = d.slice(0, start) + insert + d.slice(end);
		const caretAfter = start + insert.length;
		deps.blockEdit.updateBlockContent(deps.index, next + '\n', start, caretAfter);
		deps.setPendingCursor(caretAfter);
	}

	function selectIslandWhole(el: HTMLElement): void {
		const sel = window.getSelection();
		if (!sel) return;
		const range = document.createRange();
		range.selectNode(el);
		sel.removeAllRanges();
		sel.addRange(range);
	}

	function caretIsInTextNode(): boolean {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return false;
		return sel.getRangeAt(0).startContainer.nodeType === Node.TEXT_NODE;
	}

	function handleKeydown(e: KeyboardEvent, caretOffset: number | null): boolean {
		// Modifier chords (Ctrl/Alt/Cmd word-delete and shortcuts) stay native —
		// the island rules own only the plain edge presses.
		const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
		const isDestructive = !hasModifier && (e.key === 'Backspace' || e.key === 'Delete');
		const isTyping = !hasModifier && e.key.length === 1;
		if (!isDestructive && !isTyping) return false;

		const el = deps.getEl();
		if (!el) return false;
		const islands = islandsInDom(el);
		if (islands.length === 0) return false;

		// Second press: the native selection already wraps a replace island. Delete
		// its whole hidden range through the CST — one edit, one undo entry.
		if (isDestructive) {
			const selection = deps.getRawSelection();
			if (selection && selection.start < selection.end) {
				const selected = islands.find(
					(i) => i.end > i.start && i.start === selection.start && i.end === selection.end
				);
				if (selected) {
					e.preventDefault();
					editDisplay(selected.start, selected.end, '');
					return true;
				}
				// A different non-empty selection — leave it to the normal delete paths.
				return false;
			}
		}

		if (caretOffset === null) return false;
		const contentLength = display().length;

		// First press: Backspace at a replace island's trailing edge / Delete at its
		// leading edge selects the whole island. Selecting a hidden byte is the only
		// visible thing to eat; deleting it whole follows on the next press.
		if (isDestructive) {
			const wantTrailingEdge = e.key === 'Backspace';
			const target = islands.find(
				(i) =>
					i.end > i.start && (wantTrailingEdge ? i.end === caretOffset : i.start === caretOffset)
			);
			if (target) {
				e.preventDefault();
				selectIslandWhole(target.el);
				return true;
			}
		}

		// Widget island (zero bytes) at the caret: transparent to the adjacent real
		// byte. At a true block boundary there is none — fall through so block merge
		// still fires.
		const widget = islands.find((i) => i.start === i.end && i.start === caretOffset);
		if (!widget) return false;
		if (e.key === 'Backspace' && caretOffset > 0) {
			e.preventDefault();
			editDisplay(caretOffset - 1, caretOffset, '');
			return true;
		}
		if (e.key === 'Delete' && caretOffset < contentLength) {
			e.preventDefault();
			editDisplay(caretOffset, caretOffset + 1, '');
			return true;
		}
		// Chromium drops printable keys at an element-level position adjacent to a
		// contenteditable=false island; a text-node caret types natively.
		if (isTyping && !caretIsInTextNode()) {
			e.preventDefault();
			editDisplay(caretOffset, caretOffset, e.key);
			return true;
		}
		return false;
	}

	return { handleKeydown };
}
