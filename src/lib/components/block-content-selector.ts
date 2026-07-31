/**
 * A block's content element is the first child of its `data-block-path` wrapper that
 * is not chrome BlockHost wraps around it. Wrapper child order: badge(s), content,
 * selection overlay, decoration overlay(s), drag handle. One definition, shared by
 * the runtime (Editor.getBlockElByPath) and the e2e page-object — keep in step with
 * BlockHost if the wrapper structure changes.
 */

/** For `querySelector`, which returns the FIRST match only, so what must be excluded
 *  is the chrome that can precede the block content. */
export const BLOCK_CONTENT_SELECTOR = ':scope > :not(.selection-overlay):not(.decoration-badge)';

/** For a Playwright `locator`, which enumerates ALL matches, so every chrome child
 *  must be named — the decoration overlay is one per painted mark, not per block. */
export const BLOCK_CONTENT_LOCATOR_SELECTOR =
	':scope > *:not(.selection-overlay):not(.decoration-overlay):not(.block-drag-handle):not(.decoration-badge)';
