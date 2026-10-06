// The text block asks the pending break about a key before the shared keymap, whose edge step takes
// a plain ArrowLeft at a hidden construct edge and would leave the line open.
// Miss-analysis: Shift+Enter resets the caret's side, so no key sequence reaches the edge step with
// the line open; the order is the one thing that holds it, so the order is what this pins.
import { describe, it, expect } from 'vitest';
import { readSource } from './scan-source';

describe('G4.116 the pending break answers a key before the shared keymap', () => {
	it('runs the pending break’s keys ahead of the shared keymap', () => {
		const { code } = readSource('src/lib/components/blocks/text/TextEditableBlock.svelte');
		const keydown = code.slice(code.indexOf('async function onKeyDown('));
		const pending = keydown.indexOf('handlePendingBreakKey(');

		expect(pending).toBeGreaterThan(-1);
		expect(pending).toBeLessThan(keydown.indexOf('handleSharedKeydown('));
	});
});
