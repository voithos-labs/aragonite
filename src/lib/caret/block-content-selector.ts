/**
 * Selectors for a block's content element: the first child of its `data-block-path` wrapper
 * that is not an overlay, badge, gutter or handle. Shared by the runtime and the e2e page object.
 */

/** The overlay's paint over a range the editor draws, a box over each block and the fill between:
 *  what a block's content is not, and what a press on the range is measured against. */
export const SELECTION_PAINT_SELECTOR = '.selection-overlay';

/** For `querySelector`, which returns the first match only, so what must be excluded is
 *  whatever can come before the block content. */
export const BLOCK_CONTENT_SELECTOR = `:scope > :not(${SELECTION_PAINT_SELECTOR}):not(.decoration-badge)`;

/** For a Playwright `locator`, which returns every match, so each extra child has to be
 *  named; the decoration overlay is one per painted mark, not one per block. */
export const BLOCK_CONTENT_LOCATOR_SELECTOR = `:scope > *:not(${SELECTION_PAINT_SELECTOR}):not(.decoration-overlay):not(.block-drag-handle):not(.decoration-badge):not(.code-rail):not(.md-drawn-caret)`;

/** On the element a DOM leaf view fills, whose content element is then the text element marked
 *  with `VIEW_TEXT_ATTR` inside it: the element that takes focus and holds the caret offsets. */
export const VIEW_TEXT_HOST_ATTR = 'data-view-text-host';
export const VIEW_TEXT_ATTR = 'data-view-text';

/** A block's or a cell's editable text, which a whole-block input proxy (a hidden editing host
 *  inside a block that renders as one unit) is not. */
export const TEXT_SURFACE_SELECTOR = '[contenteditable="true"]:not([data-whole-block-input])';

/** A block's or a cell's text in every mode: editable, or read-only and keeping the tab stop reading
 *  mode gives it. A marker or chrome that isn't editable is neither. */
export const BLOCK_TEXT_SELECTOR = `${TEXT_SURFACE_SELECTOR}, [contenteditable="false"][tabindex]:not([data-whole-block-input])`;

/** Marks the element a block's drag handle centres on instead of its first line of text; here
 *  so the container marker-prefix code can set it without importing `components/`. */
export const DRAG_ANCHOR_ATTR = 'data-drag-anchor';

/** A table cell, header row included: row 0's cells are column headers to assistive tech. Used
 *  under `:scope >` from a row, and with `closest` from inside a cell. */
export const TABLE_CELL_SELECTOR = ':is([role="cell"], [role="columnheader"])';
