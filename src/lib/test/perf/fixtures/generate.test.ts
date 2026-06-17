import { describe, expect, it } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { FIXTURE_SHAPES, generateFixture, generateUniformBlocks } from './generate';

describe('fixture generators', () => {
	for (const shape of FIXTURE_SHAPES) {
		it(`${shape}: deterministic for same seed`, () => {
			expect(generateFixture(shape, 100_000, 7)).toBe(generateFixture(shape, 100_000, 7));
		});

		it(`${shape}: different seed differs`, () => {
			expect(generateFixture(shape, 100_000, 7)).not.toBe(generateFixture(shape, 100_000, 8));
		});

		it(`${shape}: overshoots target by less than one chunk`, () => {
			const out = generateFixture(shape, 100_000, 7);
			expect(out.length).toBeGreaterThanOrEqual(100_000);
			expect(out.length - 100_000).toBeLessThan(600);
		});

		it(`${shape}: round-trips losslessly`, () => {
			const src = generateFixture(shape, 100_000, 7);
			expect(serialize(parse(src))).toBe(src);
		});
	}

	// Baseline numbers are keyed to these exact bytes — corpus edits must fail
	// loudly and force deliberate re-baselining. Inline snapshots need distinct
	// call sites, so one pin per shape instead of a loop.
	it('flat-prose: exact output pinned', () => {
		expect(generateFixture('flat-prose', 200, 7)).toMatchInlineSnapshot(`
			"## alpha alpha papa lima

			india golf hotel delta india lima echo charlie mike india delta foxtrot echo india echo papa delta oscar delta charlie **charlie echo** india mike bravo oscar india juliet kilo papa juliet oscar \`november\`.

			alpha charlie foxtrot golf alpha bravo mike foxtrot golf hotel papa lima lima foxtrot foxtrot charlie charlie oscar foxtrot delta kilo foxtrot alpha kilo oscar india november kilo oscar bravo *india kilo oscar* papa november juliet papa papa india november alpha india foxtrot lima india mike papa india.

			"
		`);
	});

	it('nested-containers: exact output pinned', () => {
		expect(generateFixture('nested-containers', 200, 7)).toMatchInlineSnapshot(`
			"- alpha alpha papa lima india golf
			  - hotel delta india lima echo charlie
			    - mike india delta foxtrot echo india
			      - echo papa delta oscar delta charlie

			> charlie echo india mike bravo oscar india juliet
			> > kilo papa juliet oscar november alpha charlie foxtrot

			"
		`);
	});

	it('many-small-blocks: exact output pinned', () => {
		expect(generateFixture('many-small-blocks', 200, 7)).toMatchInlineSnapshot(`
			"alpha alpha papa lima

			india golf hotel delta

			india lima echo charlie

			mike india delta foxtrot

			echo india echo papa

			delta oscar delta charlie

			charlie echo india mike

			bravo oscar india juliet

			kilo papa juliet oscar

			"
		`);
	});

	it('single-giant-paragraph: exact output pinned', () => {
		expect(generateFixture('single-giant-paragraph', 200, 7)).toMatchInlineSnapshot(
			`"alpha alpha papa lima india golf hotel delta india lima echo charlie mike india delta foxtrot echo india echo papa delta oscar delta charlie charlie echo india mike bravo oscar india juliet kilo papa juliet oscar"`
		);
	});

	it('reference-heavy: exact output pinned', () => {
		expect(generateFixture('reference-heavy', 200, 7)).toMatchInlineSnapshot(`
			"alpha alpha papa lima india golf hotel delta india lima [echo charlie][ref-0] mike india delta foxtrot echo india echo papa.

			[ref-0]: https://example.com/0 "delta oscar"

			delta charlie charlie echo india mike bravo oscar india juliet [kilo papa][ref-1] juliet oscar november alpha charlie foxtrot golf alpha.

			[ref-1]: https://example.com/1 "bravo mike"

			"
		`);
	});

	it('table-heavy: exact output pinned', () => {
		expect(generateFixture('table-heavy', 200, 7)).toMatchInlineSnapshot(`
			"| alpha alpha | papa lima | india golf |
			| --- | --- | --- |
			| hotel delta | india lima | echo charlie |
			| mike india | delta foxtrot | echo india |
			| echo papa | delta oscar | delta charlie |
			| charlie echo | india mike | bravo oscar |
			| india juliet | kilo papa | juliet oscar |
			| november alpha | charlie foxtrot | golf alpha |
			| bravo mike | foxtrot golf | hotel papa |
			| lima lima | foxtrot foxtrot | charlie charlie |
			| oscar foxtrot | delta kilo | foxtrot alpha |
			| kilo oscar | india november | kilo oscar |

			"
		`);
	});

	it('giant-single-list: exact output pinned', () => {
		expect(generateFixture('giant-single-list', 200, 7)).toMatchInlineSnapshot(`
			"- alpha alpha papa lima india golf
			- hotel delta india lima echo charlie
			- mike india delta foxtrot echo india
			- echo papa delta oscar delta charlie
			- charlie echo india mike bravo oscar
			- india juliet kilo papa juliet oscar
			"
		`);
	});

	it('giant-single-blockquote: exact output pinned', () => {
		expect(generateFixture('giant-single-blockquote', 200, 7)).toMatchInlineSnapshot(`
			"> alpha alpha papa lima india golf hotel delta
			>
			> india lima echo charlie mike india delta foxtrot
			>
			> echo india echo papa delta oscar delta charlie
			>
			> charlie echo india mike bravo oscar india juliet
			>
			"
		`);
	});
});

describe('giant-single-container fixtures', () => {
	it('giant-single-list is ONE list of many items', () => {
		const md = generateFixture('giant-single-list', 200_000);
		const lines = md.split('\n').filter((l) => l.trim().length > 0);
		expect(lines.length).toBeGreaterThan(1000);
		expect(lines.every((l) => l.startsWith('- '))).toBe(true);
		expect(md).not.toContain('\n\n'); // no block separators -> single list node
	});

	it('giant-single-blockquote is ONE blockquote of many paragraphs', () => {
		const md = generateFixture('giant-single-blockquote', 200_000);
		const lines = md.split('\n').filter((l) => l.trim().length > 0);
		expect(lines.length).toBeGreaterThan(1000);
		expect(lines.every((l) => l.startsWith('>'))).toBe(true);
	});

	it('each giant fixture is a single top-level block', () => {
		expect(parse(generateFixture('giant-single-list', 100_000)).children.length).toBe(1);
		expect(parse(generateFixture('giant-single-blockquote', 100_000)).children.length).toBe(1);
	});
});

describe('giant-single-table fixture', () => {
	it('giant-single-table is ONE table of many rows', () => {
		const md = generateFixture('giant-single-table', 200_000);
		const lines = md.split('\n').filter((l) => l.trim().length > 0);
		// Every line is a table row ("| ... |"); no blank-line separators that would
		// split the table into multiple top-level blocks.
		expect(lines.length).toBeGreaterThan(1000);
		expect(lines.every((l) => l.startsWith('|'))).toBe(true);
		expect(md).not.toContain('\n\n'); // no block separators -> single table node
	});

	it('is deterministic for a fixed seed', () => {
		expect(generateFixture('giant-single-table', 50_000, 7)).toBe(
			generateFixture('giant-single-table', 50_000, 7)
		);
	});

	it('parses to a single top-level table block', () => {
		const doc = parse(generateFixture('giant-single-table', 100_000));
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('table');
	});
});

describe('generateUniformBlocks', () => {
	it('produces exactly blockCount paragraphs', () => {
		expect(parse(generateUniformBlocks(50, 4)).children).toHaveLength(50);
	});

	it('is deterministic for the same args', () => {
		expect(generateUniformBlocks(20, 6)).toBe(generateUniformBlocks(20, 6));
	});

	it('content size scales with wordsPerBlock at fixed block count', () => {
		const small = generateUniformBlocks(10, 2);
		const large = generateUniformBlocks(10, 40);
		expect(parse(small).children).toHaveLength(10);
		expect(parse(large).children).toHaveLength(10);
		expect(large.length).toBeGreaterThan(small.length * 5);
	});
});
