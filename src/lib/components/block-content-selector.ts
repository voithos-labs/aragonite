/**
 * A block's content element is the first child of its `data-block-path` wrapper
 * that is none of the chrome BlockHost wraps around it. The wrapper's child order
 * is [decoration badge(s), block content, selection overlay, decoration overlay(s),
 * drag handle], so a first-non-chrome lookup addresses the block itself. This is
 * the one definition of that lookup, shared by the runtime
 * (Editor.getBlockElByPath) and the e2e page-object; keep in step with BlockHost's
 * badge/overlay/handle children if the wrapper structure changes.
 */

/**
 * For `querySelector`, which returns the FIRST match only. Everything the block
 * content precedes — both overlays and the drag handle — is unreachable by
 * first-match, so only the badges that render BEFORE it need excluding.
 */
export const BLOCK_CONTENT_SELECTOR = ':scope > :not(.selection-overlay):not(.decoration-badge)';

/**
 * For a Playwright `locator`, which enumerates ALL matches, so every chrome child
 * must be named or the match count runs high. The decoration overlay is one per
 * painted mark rather than one per block, so omitting it inflated the count by an
 * amount that varied with the live decoration set.
 */
export const BLOCK_CONTENT_LOCATOR_SELECTOR =
	':scope > *:not(.selection-overlay):not(.decoration-overlay):not(.block-drag-handle):not(.decoration-badge)';
