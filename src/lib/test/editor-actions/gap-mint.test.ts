import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { makeNestedHarness, makeTopHarness } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

// The gap caret's mint, byte-oracled: a paragraph minted at a boundary must serialize to the
// document the user would have typed, with the separators GFM needs to reload the same tree.

const TABLE = '| a | b |\n| - | - |\n| c | d |\n';
const FENCE = '```\ncode\n```\n';
/** paragraph, table, fencedCode, paragraph — the eligible boundary is 2. */
const TABLE_THEN_FENCE = `para\n\n${TABLE}\n${FENCE}\ntail\n`;

describe('a paragraph minted at a boundary round-trips', () => {
	it('carries its text between a table and a fence', async () => {
		const h = makeTopHarness(TABLE_THEN_FENCE);

		await h.actions.insertParagraph(2, 'x');

		expect(serialize(h.doc)).toBe(`para\n\n${TABLE}\nx\n\n${FENCE}\ntail\n`);
		expect(serialize(parse(serialize(h.doc)))).toBe(serialize(h.doc));
		expect(h.doc.children.map((c) => c.kind)).toEqual([
			'paragraph',
			'table',
			'paragraph',
			'fencedCode',
			'paragraph'
		]);
	});

	// G2.13: a blank block IS a blank line, so it shares the follower's separator rather than
	// stacking a second one that would reload as an extra empty paragraph.
	it('is empty when Enter mints it, and shares its follower separator', async () => {
		const h = makeTopHarness(TABLE_THEN_FENCE);

		await h.actions.insertParagraph(2, '');

		expect(serialize(h.doc)).toBe(`para\n\n${TABLE}\n\n${FENCE}\ntail\n`);
		expect(serialize(parse(serialize(h.doc)))).toBe(serialize(h.doc));
		expect(h.doc.children).toHaveLength(5);
	});

	// GH #73: the head's own fill correctly declines a separator at bodyStart, so the block the
	// mint displaced is the one owed the line — in SOURCE only, which no byte round-trip sees.
	it('hands the displaced head its own separator once the mint is typed into', async () => {
		const h = makeTopHarness(`${TABLE}\n${FENCE}`);

		await h.actions.insertParagraph(0, '');
		await h.actions.updateBlockContent(0, 'q\n');

		expect(serialize(h.doc)).toBe(`q\n\n${TABLE}\n${FENCE}`);
		expectParseConverged(h.doc);
	});

	// The head slot owns no separator, so the mint takes the old head's and hands one back.
	it('at the scope head pushes the separator down to the block it displaced', async () => {
		const h = makeTopHarness(`${TABLE}\n${FENCE}`);

		await h.actions.insertParagraph(0, 'x');

		expect(serialize(h.doc)).toBe(`x\n\n${TABLE}\n${FENCE}`);
		expect(serialize(parse(serialize(h.doc)))).toBe(serialize(h.doc));
	});

	// G4.20: the separator and the paragraph's own ending both come off a neighbour.
	it('takes a CRLF document its own line endings', async () => {
		const crlf = TABLE_THEN_FENCE.replace(/\n/g, '\r\n');
		const h = makeTopHarness(crlf);

		await h.actions.insertParagraph(2, 'x');

		expect(serialize(h.doc)).toBe(crlf.replace('\r\n```', '\r\nx\r\n\r\n```'));
		expect(serialize(h.doc)).not.toContain('\n\n');
	});

	it('emits insertBlock at the minted block, not at the boundary neighbour', async () => {
		const h = makeTopHarness(TABLE_THEN_FENCE);

		await h.actions.insertParagraph(2, 'x');

		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'insertBlock', path: [2] });
	});
});

describe('a paragraph minted inside a container', () => {
	// The scope-end boundary containers own: index === children.length, which the root excludes.
	it('lands inside the quote at the scope-end boundary', async () => {
		const h = makeNestedHarness(`> para\n>\n> \`\`\`\n> code\n> \`\`\`\n`, { index: 0 });

		await h.bundle.blockEdit.insertParagraph(2, 'x');

		expect(serialize(h.deps.doc)).toBe(`> para\n>\n> \`\`\`\n> code\n> \`\`\`\n>\n> x\n`);
		expect(serialize(parse(serialize(h.deps.doc)))).toBe(serialize(h.deps.doc));
	});

	it('lands between two quoted siblings', async () => {
		const h = makeNestedHarness(`> \`\`\`\n> code\n> \`\`\`\n>\n> | a |\n> | - |\n`, { index: 0 });

		await h.bundle.blockEdit.insertParagraph(1, 'x');

		expect(serialize(parse(serialize(h.deps.doc)))).toBe(serialize(h.deps.doc));
		expect(h.getNode().children!.map((c) => c.kind)).toEqual(['fencedCode', 'paragraph', 'table']);
	});
});
