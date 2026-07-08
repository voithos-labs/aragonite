import { describe, it, expect } from 'vitest';
import { isBuiltinInlineKind } from '$lib/core/nodes';

describe('AnyInlineKind', () => {
	it('narrows built-in kinds and rejects plugin kinds', () => {
		expect(isBuiltinInlineKind('emphasis')).toBe(true);
		expect(isBuiltinInlineKind('image')).toBe(true);
		// a plugin kind string is not a built-in
		expect(isBuiltinInlineKind('math' as never)).toBe(false);
	});

	// Table completeness is compile-time enforced by `Record<InlineNodeKind, true>` —
	// no redundant runtime key-list assertion (forge-tests: don't test what the type guarantees).
});
