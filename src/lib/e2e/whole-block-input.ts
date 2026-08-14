import type { Locator } from '@playwright/test';

/**
 * The hidden editing host inside a `blockFocus: 'whole-block'` block: where DOM focus actually
 * sits, so `beforeinput` and `compositionend` reach the mint. Always scoped to one block — a
 * document-wide locator passes on the wrong diagram in a multi-block fixture.
 */
export function wholeBlockInput(block: Locator): Locator {
	return block.locator('[data-whole-block-input]');
}
