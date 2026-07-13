import { describe, it, expect } from 'vitest';
import { isBuiltinInlineKind } from '$lib/core/nodes';

describe('AnyInlineKind', () => {
	it('narrows built-in kinds and rejects plugin kinds', () => {
		expect(isBuiltinInlineKind('emphasis')).toBe(true);
		expect(isBuiltinInlineKind('image')).toBe(true);
		expect(isBuiltinInlineKind('math' as never)).toBe(false);
	});

	// No runtime key-list assertion here on purpose: `Record<InlineNodeKind, true>`
	// already enforces table completeness at compile time.
});
