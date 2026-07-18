import { describe, expect, it } from 'vitest';
import { registerInlineSyntax } from '$lib/plugin';

// WALL PIN — pins CURRENT behaviour, not the behaviour a footnote plugin wants.
// The GFM footnote reference `[^label]` cannot be a first-class inline kind
// because the built-in scanner reserves the `[` trigger and dispatches it before
// the plugin registry (wall log W1). This test documents the BLOCKER; if the
// freeze surface ever grants a prefix recognizer for `[`, DELETE this pin rather
// than "fixing" it.
describe('WALL PIN: the inline `[` trigger is unavailable to plugins', () => {
	it('rejects registering a recognizer on the `[` trigger', () => {
		expect(() => registerInlineSyntax('[', () => null)).toThrow(/claimed by the built-in scanner/);
	});
});
