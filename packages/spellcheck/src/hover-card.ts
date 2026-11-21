/**
 * The hover card: the Spelling rows over a waved word, opened through the editor's `openRows` once
 * the pointer rests on the word, or at once from the keyboard (`decorations.activateAtCaret`).
 */

import type { Editor, MarkAt, SelectionAction } from '@voithos-labs/aragonite/plugin';
import { createSpellHover } from './hover';
import { wordAt } from './misspelling';

export interface HoverCard {
	hover(at: MarkAt | null): void;
	activate(at: MarkAt): void;
	dispose(): void;
}

export function createHoverCard(editor: Editor, action: SelectionAction): HoverCard {
	let menusOpen = false;
	let onCard = false;
	editor.on('menu', (open) => (menusOpen = open));

	const card = createSpellHover({
		open(misspelling, anchor) {
			onCard = false;
			const rows = editor.openRows(action, misspelling, anchor, (inside) => {
				onCard = inside;
				if (!inside) card.menuLeft();
			});
			return rows.isOpen ? { isOpen: () => rows.isOpen, close: () => rows.close() } : null;
		},
		menusOpen: () => menusOpen,
		rangeSelected() {
			const selection = editor.selection;
			return !!selection && !selection.empty && !selection.cells;
		},
		pointerOnMenu: () => onCard
	});

	return {
		hover(at) {
			const word = at && wordAt(editor, at.range.from);
			if (at && word) card.hover(word, at.anchor);
			else card.left();
		},
		activate(at) {
			const word = wordAt(editor, at.range.from);
			if (word) card.activate(word, at.anchor);
		},
		dispose: () => card.dispose()
	};
}
