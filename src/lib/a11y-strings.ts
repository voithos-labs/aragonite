/**
 * Accessible names, tooltips, and live-region announcements in one table, so a future
 * locale pass has one seam. Internal — no barrel exports it.
 */

import type { TableAlignment } from './core/nodes';

// ── Editor chrome ────────────────────────────────────────────────────────────

export const EDITOR_LABEL = 'Markdown editor';
export const DRAG_HANDLE_TITLE = 'Drag to reorder — or Alt+↑ / Alt+↓';
export const FAILED_BLOCK_LABEL = 'Block failed to render';
export const GAP_CARET_LABEL = 'Insertion point between blocks';
export const WHOLE_BLOCK_INPUT_LABEL = 'Focused block input';
export const IMAGE_PROPERTIES_LABEL = 'Image properties';
export const IMAGE_ALT_FIELD = 'Alt text';
export const IMAGE_ALT_PLACEHOLDER = 'Describe the image';
export const IMAGE_CROP = 'Crop image';
export const IMAGE_CROP_APPLY = 'Apply crop';
export const IMAGE_CROP_CANCEL = 'Cancel crop';
export const IMAGE_REMOVE = 'Remove image';
export const LINK_CARD_LABEL = 'Link properties';
export const LINK_CARD_URL = 'Link URL';
export const LINK_CARD_OPEN = 'Open link';
export const LINK_CARD_REMOVE = 'Remove link';
export const CODE_LANGUAGE_FIELD = 'Code block language';

export const CODE_RUN_LABEL = 'Run code block';
export const CODE_COPY_LABEL = 'Copy code';
export const CODE_COPIED_LABEL = 'Code copied';
export const CODE_MENU_LABEL = 'Code block actions';
export const CODE_RAIL_LABEL = 'Code block controls';
export const CODE_LANGUAGE_LIST = 'Code block languages';

/** Chrome, not an announcement: the language chip's accessible name. */
export function codeLanguageLabel(language: string): string {
	return `Code language: ${language}`;
}

// ── Search bar ───────────────────────────────────────────────────────────────
// A _TITLE/_LABEL pair is a tooltip that reads shorter than its accessible name.

export const SEARCH_TOGGLE_REPLACE = 'Toggle replace';
export const SEARCH_FIND = 'Find';
export const SEARCH_REPLACE = 'Replace';
export const SEARCH_MATCH_CASE = 'Match case';
export const SEARCH_WHOLE_WORD = 'Whole word';
export const SEARCH_REGEX = 'Regex';
export const SEARCH_PREVIOUS_TITLE = 'Previous';
export const SEARCH_PREVIOUS_LABEL = 'Previous match';
export const SEARCH_NEXT_TITLE = 'Next';
export const SEARCH_NEXT_LABEL = 'Next match';
export const SEARCH_CLOSE_TITLE = 'Close';
export const SEARCH_CLOSE_LABEL = 'Close search';

// ── Table action menu ────────────────────────────────────────────────────────

export const TABLE_ACTIONS = 'Table actions';
export const COLUMN_ALIGNMENT = 'Column alignment';
export const ADD_ROW_BELOW = 'Add row';
export const ADD_COLUMN_RIGHT = 'Add column';
export const TAIL_ADD_ROW = 'Add a line below';
export const TAIL_ADD_BLOCK = 'Add a block';
export const BLOCK_MENU_LABEL = 'Insert a block';
export const BLOCK_ACTIONS_LABEL = 'Block actions';
export const ALIGN_LEFT = 'Left';
export const ALIGN_CENTER = 'Center';
export const ALIGN_RIGHT = 'Right';

// ── Live-region announcements ────────────────────────────────────────────────

export const INSERTED_ROW = 'Inserted row';
export const INSERTED_COLUMN = 'Inserted column';
export const DELETED_ROW = 'Deleted row';
export const DELETED_COLUMN = 'Deleted column';
export const COLUMN_ALIGNMENT_CLEARED = 'Column alignment cleared';
export const SELECTED_ACROSS_BLOCKS = 'Selected text across blocks';

export function columnAligned(alignment: Exclude<TableAlignment, 'none'>): string {
	return `Column aligned ${alignment}`;
}

export function movedBlockToPosition(position: number, total: number): string {
	return `Moved block to position ${position} of ${total}`;
}

export function movedRowToPosition(position: number, total: number): string {
	return `Moved row to position ${position} of ${total}`;
}

export function movedColumnToPosition(position: number, total: number): string {
	return `Moved column to position ${position} of ${total}`;
}

export function selectedBlocks(count: number): string {
	return `Selected ${count} blocks`;
}
