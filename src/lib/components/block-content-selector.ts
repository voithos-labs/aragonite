/**
 * A block's content element is the first child of its `data-block-path` wrapper
 * that is neither a selection overlay nor a decoration badge. BlockHost lays the
 * wrapper out as [decoration badge(s), block content, selection overlay, drag
 * handle], so a first-non-overlay lookup addresses the block itself. This is the
 * one definition of that lookup, shared by the runtime (Editor.getBlockElByPath)
 * and the e2e page-object; keep in step with BlockHost's badge/overlay/handle
 * children if the wrapper structure changes.
 */

/**
 * For `querySelector`, which returns the FIRST match only. The drag handle renders
 * last, so first-match reaches the content before it and the handle needs no
 * exclusion.
 */
export const BLOCK_CONTENT_SELECTOR = ':scope > :not(.selection-overlay):not(.decoration-badge)';

/**
 * For a Playwright `locator`, which enumerates ALL matches. The trailing drag
 * handle is also a non-overlay, non-badge child, so it must be excluded too or the
 * match count runs one-too-many per block.
 */
export const BLOCK_CONTENT_LOCATOR_SELECTOR =
	':scope > *:not(.selection-overlay):not(.block-drag-handle):not(.decoration-badge)';
