import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { rebuildUnsharedAncestry } from '../tree-operations/unshare';
import { createSharingState } from '../tree-operations/sharing';
import { roundTripCases } from '$lib/test/support/round-trip';

describe('round-trip — task items', () => {
	roundTripCases([
		{ name: 'canonical lowercase [x]', source: '- [x] done\n' },
		{ name: 'canonical [ ]', source: '- [ ] pending\n' },
		{ name: 'uppercase [X]', source: '- [X] upper\n' },
		{ name: 'multi-space variant', source: '- [x]  extra\n' },
		{ name: 'multiple task items in one list', source: '- [x] done\n- [ ] todo\n- [X] upper\n' },
		{
			name: 'task item with multi-paragraph content',
			source: '- [x] first paragraph\n\n  second paragraph\n'
		},
		{ name: 'nested task sub-list', source: '- [x] outer\n  - [ ] nested\n' }
	]);

	it('rebuild after inner paragraph edit preserves taskMarker variant', () => {
		const source = '- [X] upper\n';
		const doc = parse(source);
		const item = doc.children[0].children![0];
		const para = item.children![0];

		para.raw = 'upper more\n';
		rebuildUnsharedAncestry(doc, [0, 0, 0], createSharingState(), null, undefined);

		expect(serialize(doc)).toBe('- [X] upper more\n');
	});

	it('rebuild after inner edit preserves multi-space variant', () => {
		const source = '- [x]  extra\n';
		const doc = parse(source);
		const para = doc.children[0].children![0].children![0];

		para.raw = 'extra more\n';
		rebuildUnsharedAncestry(doc, [0, 0, 0], createSharingState(), null, undefined);

		expect(serialize(doc)).toBe('- [x]  extra more\n');
	});
});
