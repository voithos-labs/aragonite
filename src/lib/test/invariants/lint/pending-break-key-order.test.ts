// The text block asks the pending break about a key before the shared keymap, which would take an
// ArrowLeft at the text's start up to the block above and keep the line open. The behavior rows
// (`e2e/tests/presentation/pending-break-keys.spec.ts`) are the guard; this pins the order too.
// Miss-analysis: the first header said no key sequence reached the keymap first; one does.
import { describe, it, expect } from 'vitest';
import { readSource } from './scan-source';
import { SOURCE } from './source-paths';

describe('G4.116 the pending break answers a key before the shared keymap', () => {
	it('runs the pending break’s keys ahead of the shared keymap', () => {
		const { code } = readSource(SOURCE.textBlock);
		const keydown = code.slice(code.indexOf('async function onKeyDown('));
		const pending = keydown.indexOf('handlePendingBreakKey(');

		expect(pending).toBeGreaterThan(-1);
		expect(pending).toBeLessThan(keydown.indexOf('handleSharedKeydown('));
	});
});
