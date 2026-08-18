import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { rebuildListItemRaw } from '../../../schema/container-rebuilders';
import type { Document } from '../../../core/nodes';

// CommonMark §5.2 lazy continuation for list items, mirroring the blockquote laziness pins
// in parser-structure.test.ts. Every fixture asserts the byte round-trip, because the
// container `raw` keeps the un-indented source verbatim.

function topKinds(doc: Document): string[] {
	return doc.children.map((c) => (c.kind === 'list' ? `list(${c.children!.length})` : c.kind));
}

function firstItemParagraph(doc: Document): string {
	return doc.children[0].children![0].children![0].raw;
}

describe('list lazy continuation: topology', () => {
	const cases: [name: string, source: string, top: string[]][] = [
		['single wrapped tail', '- item one\nwrapped tail\n', ['list(1)']],
		['multiple lazy lines', '- a\nb\nc\n', ['list(1)']],
		['lazy joins the last item', '- one\n- two\nlazy\n', ['list(2)']],
		['lazy between items', '- a\nlazy\n- b\n', ['list(2)']],
		['ordered siblings then lazy', '1. a\n2. b\n3. c\nlazy\n', ['list(3)']],
		['task item absorbs lazy', '- [ ] todo\nmore\n', ['list(1)']],
		['crlf wrapped tail', '- item one\r\nwrapped tail\r\n', ['list(1)']]
	];

	for (const [name, source, top] of cases) {
		it(name, () => {
			const doc = parse(source);
			expect(topKinds(doc)).toEqual(top);
			expect(serialize(doc)).toBe(source);
		});
	}

	it('joins both lines into one item paragraph', () => {
		expect(firstItemParagraph(parse('- item one\nwrapped tail\n'))).toBe(
			'item one\nwrapped tail\n'
		);
	});

	it('lazy joins the trailing item paragraph, not an earlier one', () => {
		const doc = parse('- one\n- two\nlazy\n');
		expect(doc.children[0].children![1].children![0].raw).toBe('two\nlazy\n');
	});
});

describe('list lazy continuation: a marker or opener is never lazy', () => {
	// An ordered marker not starting at 1 cannot interrupt a paragraph (§5.2), but inside a
	// list it is still a block-level item, never absorbed as lazy paragraph text.
	const cases: [name: string, source: string, top: string[]][] = [
		['ordered non-1 sibling stays an item', '1. a\n2. b\n', ['list(2)']],
		['ordered non-1 after a bullet starts a new list', '- a\n2. b\n', ['list(1)', 'list(1)']],
		['heading interrupter stays separate', '- item\n# heading\n', ['list(1)', 'heading']],
		['thematic break interrupter stays separate', '- a\n***\n', ['list(1)', 'thematicBreak']],
		['blank line ends the item', '- item\n\nafter\n', ['list(1)', 'paragraph']],
		['non-paragraph first line does not open laziness', '- # h\nlazy\n', ['list(1)', 'paragraph']]
	];

	for (const [name, source, top] of cases) {
		it(name, () => {
			const doc = parse(source);
			expect(topKinds(doc)).toEqual(top);
			expect(serialize(doc)).toBe(source);
		});
	}
});

describe('list lazy continuation: bounded nested divergence', () => {
	// A deliberate CommonMark divergence, matching the blockquote parser's approximation:
	// laziness reaches only the item's own top-level paragraph, never a nested sub-list's.
	it('a lazy line after a nested item stays a separate block', () => {
		const source = '- outer\n  - inner\nlazy\n';
		const doc = parse(source);
		expect(topKinds(doc)).toEqual(['list(1)', 'paragraph']);
		expect(doc.children[1].raw).toBe('lazy\n');
		expect(serialize(doc)).toBe(source);
	});
});

describe('list lazy continuation: rebuild', () => {
	// A lazily-parsed item has no indent on its continuation line, so the first structural
	// edit normalizes it, the way blockquote's rebuild re-adds the `> ` prefix.
	it('normalizes the lazy continuation to indented form, reparse-stable', () => {
		const item = parse('- item one\nwrapped tail\n').children[0].children![0];
		rebuildListItemRaw(item);
		expect(item.raw).toBe('- item one\n  wrapped tail\n');

		const reparsed = parse(item.raw);
		expect(topKinds(reparsed)).toEqual(['list(1)']);
		expect(firstItemParagraph(reparsed)).toBe('item one\nwrapped tail\n');
	});
});
