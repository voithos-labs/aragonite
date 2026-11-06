import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { rebuildUnsharedAncestry } from '../tree-operations/chain-rebuild';
import { createSharingState } from '../tree-operations/sharing';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

describe('task items: rebuild keeps the marker variant', () => {
	it('rebuild after inner paragraph edit preserves taskMarker variant', () => {
		const source = '- [X] upper\n';
		const doc = parse(source);
		const item = doc.children[0].children![0];
		const para = item.children![0];

		para.raw = 'upper more\n';
		rebuildUnsharedAncestry(doc, [0, 0, 0], createSharingState(), null, defaultGrammarView);

		expect(serialize(doc)).toBe('- [X] upper more\n');
	});

	it('rebuild after inner edit preserves multi-space variant', () => {
		const source = '- [x]  extra\n';
		const doc = parse(source);
		const para = doc.children[0].children![0].children![0];

		para.raw = 'extra more\n';
		rebuildUnsharedAncestry(doc, [0, 0, 0], createSharingState(), null, defaultGrammarView);

		expect(serialize(doc)).toBe('- [x]  extra more\n');
	});
});
