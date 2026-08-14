import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { rebuildUnsharedAncestry } from '../tree-operations/unshare';
import { createSharingState } from '../tree-operations/sharing';

describe('round-trip — task items', () => {
	it('fresh parse + serialize preserves canonical lowercase [x]', () => {
		const source = '- [x] done\n';
		expect(serialize(parse(source))).toBe(source);
	});

	it('fresh parse + serialize preserves canonical [ ]', () => {
		const source = '- [ ] pending\n';
		expect(serialize(parse(source))).toBe(source);
	});

	it('fresh parse + serialize preserves uppercase [X]', () => {
		const source = '- [X] upper\n';
		expect(serialize(parse(source))).toBe(source);
	});

	it('fresh parse + serialize preserves multi-space variant', () => {
		const source = '- [x]  extra\n';
		expect(serialize(parse(source))).toBe(source);
	});

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

	it('multiple task items in one list round-trip independently', () => {
		const source = '- [x] done\n- [ ] todo\n- [X] upper\n';
		expect(serialize(parse(source))).toBe(source);
	});

	it('task item with multi-paragraph content round-trips', () => {
		const source = '- [x] first paragraph\n\n  second paragraph\n';
		expect(serialize(parse(source))).toBe(source);
	});

	it('nested task sub-list round-trips', () => {
		const source = '- [x] outer\n  - [ ] nested\n';
		expect(serialize(parse(source))).toBe(source);
	});
});
