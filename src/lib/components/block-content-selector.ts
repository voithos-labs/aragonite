/**
 * A block's content element is the first child of its `data-block-path` wrapper that is not one
 * of the extras around it (child order: badges, content, the code block's side gutter, selection
 * overlay, decoration overlays, drag handle). One definition, shared by the runtime and the e2e
 * page object.
 */

/** For `querySelector`, which returns the first match only, so what must be excluded is
 *  whatever can come before the block content. */
export const BLOCK_CONTENT_SELECTOR = ':scope > :not(.selection-overlay):not(.decoration-badge)';

/** For a Playwright `locator`, which returns every match, so each extra child has to be
 *  named; the decoration overlay is one per painted mark, not one per block. */
export const BLOCK_CONTENT_LOCATOR_SELECTOR =
	':scope > *:not(.selection-overlay):not(.decoration-overlay):not(.block-drag-handle):not(.decoration-badge):not(.code-rail)';

/** Marks the element a block's drag handle centres on (`drag-handle.ts`); without it, the
 *  block's first line of text is used. Here rather than beside the handle so the code that
 *  builds the container's marker prefix can set it without reaching into `components/`. */
export const DRAG_ANCHOR_ATTR = 'data-drag-anchor';

/** A table cell, header row included: row 0's cells are column headers to assistive tech. Used
 *  under `:scope >` from a row, and with `closest` from inside a cell. */
export const TABLE_CELL_SELECTOR = ':is([role="cell"], [role="columnheader"])';
