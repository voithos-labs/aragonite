import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { mergeListItemIntoPrevious } from '$lib/tree-operations/list/unwrap-merge';

// Preserve-absolute-indent relocation of the merged-away item's remaining
// children. merge-list-item.test.ts pins tree shape + mergePoint; this file
// pins the serialized markdown the relocation produces.

function mergeAndSerialize(src: string, currentIndex: number): string {
	const doc = parse(src);
	const list = doc.children[0];
	if (list?.kind !== 'list') {
		throw new Error(`expected list, got ${list?.kind}`);
	}
	mergeListItemIntoPrevious(list, list.children!.slice(), currentIndex);
	return serialize(doc);
}

describe('relocateRemainingChildren (via mergeListItemIntoPrevious)', () => {
	it('depth-0 target: trailing paragraph absorbed into the target item', () => {
		const result = mergeAndSerialize('- A\n- B\n\n  extra\n', 1);

		expect(result).toBe('- AB\n  extra\n');
		expect(serialize(parse(result))).toBe(result);
	});

	it('depth-≥1 target: nested-list items promote to the depth-1 sibling list', () => {
		const result = mergeAndSerialize('- A\n  - B\n    - C\n- D\n  - E\n', 1);

		// E keeps absolute depth 1 (no blank line — its leadingTrivia is cleared).
		expect(result).toBe('- A\n  - B\n    - CD\n  - E\n');
		expect(serialize(parse(result))).toBe(result);
	});

	it('depth-≥1 target: non-list child absorbed into the target item with trivia cleared', () => {
		const result = mergeAndSerialize('- A\n  - B\n- C\n\n  extra\n', 1);

		expect(result).toBe('- A\n  - BC\n    extra\n');
		expect(serialize(parse(result))).toBe(result);
	});
});
