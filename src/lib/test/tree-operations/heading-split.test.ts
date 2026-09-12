import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { splitNode } from '../../tree-operations';

// Enter at the head of an ATX heading's text moves the whole heading down: the marker belongs
// with its text, where the plain cut would leave an empty heading above demoted prose below.
// At the split primitive, so every road to a split (a keymap Enter, a container's exit) agrees.
describe('splitNode — an ATX heading cut at or before its content start', () => {
	it.each([0, 1, 3])('at offset %i lands the whole heading below an empty paragraph', (offset) => {
		const doc = parse('## Title\n');
		splitNode(doc, 0, offset, undefined, undefined, undefined);
		expect(doc.children.map((c) => c.raw)).toEqual(['\n', '## Title\n']);
	});

	// The gate is the kind's content range, which skips the indent a `^#` regex never reaches.
	it('reads the content start of an indented heading', () => {
		const doc = parse('  ## Indented\n');
		splitNode(doc, 0, 4, undefined, undefined, undefined);
		expect(doc.children.map((c) => c.raw)).toEqual(['\n', '  ## Indented\n']);
	});

	it('past the content start cuts the text as any block does', () => {
		const doc = parse('## Title\n');
		splitNode(doc, 0, 5, undefined, undefined, undefined);
		expect(doc.children.map((c) => c.raw)).toEqual(['## Ti\n', 'tle\n']);
	});
});
