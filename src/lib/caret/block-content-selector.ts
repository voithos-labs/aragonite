/**
 * Selectors for a block's content element: the first child of its `data-block-path` wrapper
 * that is not an overlay, badge, gutter or handle. Shared by the runtime and the e2e page object.
 */

/** For `querySelector`, which returns the first match only, so what must be excluded is
 *  whatever can come before the block content. */
export const BLOCK_CONTENT_SELECTOR = ':scope > :not(.selection-overlay):not(.decoration-badge)';

/** For a Playwright `locator`, which returns every match, so each extra child has to be
 *  named; the decoration overlay is one per painted mark, not one per block. */
export const BLOCK_CONTENT_LOCATOR_SELECTOR =
	':scope > *:not(.selection-overlay):not(.decoration-overlay):not(.block-drag-handle):not(.decoration-badge):not(.code-rail):not(.md-drawn-caret)';

/** Marks the element a block's drag handle centres on instead of its first line of text; here
 *  so the container marker-prefix code can set it without importing `components/`. */
export const DRAG_ANCHOR_ATTR = 'data-drag-anchor';

/** A table cell, header row included: row 0's cells are column headers to assistive tech. Used
 *  under `:scope >` from a row, and with `closest` from inside a cell. */
export const TABLE_CELL_SELECTOR = ':is([role="cell"], [role="columnheader"])';
