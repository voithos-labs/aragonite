import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { reorderChildrenWithTrivia } from '$lib/tree-operations/reorder';
import { createSharingState } from '$lib/tree-operations/sharing';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { defaultGrammarView } from '$lib/schema/block-openers';

// GH #461: an HTML block ends only at a blank line, so a move that takes away the block holding
// that line leaves it flush above its new follower, and the reload reads every block down to the
// next blank line as HTML text. The move writes the blank line instead.
// Miss-analysis: the vacated join's rejoin was pinned on two paragraphs only, and the property
// suite draws a fresh shape set per seed, so no fixed case put a block that swallows every line
// under it above that join.

function move(markdown: string, from: number, to: number) {
	const doc = parse(markdown);
	reorderChildrenWithTrivia(doc.children, from, to, createSharingState(), defaultGrammarView, true);
	return doc;
}

const kinds = (doc: ReturnType<typeof parse>) => doc.children.map((c) => c.kind);

describe('a move never lets an HTML block take the blocks after it (GH #461)', () => {
	it('keeps the quote and the list below the HTML block their own blocks', () => {
		const doc = move(
			'Intro prose that runs on.\n<div>\nx\n</div>\n\nIntro prose that runs on.\n> quoted line\n- one\n- two\n',
			2,
			0
		);

		expect(serialize(doc)).toBe(
			'Intro prose that runs on.\n\nIntro prose that runs on.\n\n<div>\nx\n</div>\n\n> quoted line\n- one\n- two\n'
		);
		expect(kinds(doc)).toEqual(['paragraph', 'paragraph', 'htmlBlock', 'blockquote', 'list']);
		expect(describeConvergence(doc)).toBeNull();
	});

	// A paragraph line under `</div>` continues the HTML block, in both kinds that end at a blank
	// line: the tag-named block and the one opened by any complete tag.
	it.each([
		['a block-level tag', '<div>\nx\n</div>'],
		['any complete tag', '<custom-el>\nx']
	])('keeps a paragraph below %s a paragraph', (_label, html) => {
		const doc = move(`${html}\n\n# Heading\nprose\n`, 1, 0);

		expect(serialize(doc)).toBe(`# Heading\n\n${html}\n\nprose\n`);
		expect(kinds(doc)).toEqual(['heading', 'htmlBlock', 'paragraph']);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('writes the blank line in the document’s own line ending', () => {
		const doc = move('<div>\r\nx\r\n</div>\r\n\r\n# Heading\r\nprose\r\n', 1, 0);

		expect(serialize(doc)).toBe('# Heading\r\n\r\n<div>\r\nx\r\n</div>\r\n\r\nprose\r\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	// The rejoin the move leaves between two paragraphs is still the reload's own reading.
	it('still rejoins two paragraphs the moved block stood between', () => {
		const doc = move('a\n# h\nb\n', 1, 0);

		expect(serialize(doc)).toBe('# h\na\nb\n');
		expect(kinds(doc)).toEqual(['heading', 'paragraph']);
	});
});
