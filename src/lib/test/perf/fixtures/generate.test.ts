import { describe, expect, it } from 'vitest';
import type { CstNode } from '../../../core/nodes';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { docByteLength } from '../../../perf/instruments';
import { containerRawBytes } from '../container-raw-bytes';
import {
	FIXTURE_SHAPES,
	generateFixture,
	generateUniformBlocks,
	generateDeepNested,
	deepNestedLeafPath
} from './generate';

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

// Walk the descent spine, collecting each container's raw length outermost-first.
function spineContainerRaws(root: CstNode): number[] {
	const raws: number[] = [];
	let node: CstNode | undefined = root;
	while (node?.children) {
		raws.push(node.raw.length);
		node = node.children.find((c) => c.children);
	}
	return raws;
}

function nodeAtPath(root: CstNode, path: number[]): CstNode {
	let node = root as CstNode;
	for (const i of path) node = node.children![i];
	return node;
}

describe('generateDeepNested', () => {
	it('is deterministic for the same args', () => {
		expect(generateDeepNested(8, 2_000, 7)).toBe(generateDeepNested(8, 2_000, 7));
	});

	it('a different seed differs', () => {
		expect(generateDeepNested(8, 2_000, 7)).not.toBe(generateDeepNested(8, 2_000, 8));
	});

	for (const [depth, bytes] of [
		[6, 2_000],
		[12, 10_000]
	] as const) {
		it(`round-trips losslessly @ depth ${depth} × ${bytes}B`, () => {
			const src = generateDeepNested(depth, bytes, 7);
			expect(serialize(parse(src))).toBe(src);
		});
	}

	it('is one deep container, not a flat pile', () => {
		const doc = parse(generateDeepNested(8, 4_000, 7));
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].children).toBeDefined();
	});

	it('the deepest leaf is a typeable paragraph at deepNestedLeafPath', () => {
		const depth = 8;
		const doc = parse(generateDeepNested(depth, 4_000, 7));
		const leaf = nodeAtPath(doc.children[0] as CstNode, deepNestedLeafPath(depth).slice(1));
		expect(leaf.kind).toBe('paragraph');
		expect(leaf.children).toBeUndefined();
	});

	// The load-bearing property: every level carries sibling bytes, so each spine
	// container's raw materializes everything from its level inward and sheds one
	// level's worth going deeper. A spine-only tree (tiny per-level raw) would fail
	// this and silently understate the ancestry-rebuild tax the bench measures.
	it('each level carries bytes: spine raws non-increasing, outermost ≈ whole doc', () => {
		const doc = parse(generateDeepNested(8, 10_000, 7));
		const raws = spineContainerRaws(doc.children[0]);
		expect(raws[0]).toBeGreaterThanOrEqual(docByteLength(doc) * 0.95);
		for (let i = 1; i < raws.length; i++) expect(raws[i]).toBeLessThanOrEqual(raws[i - 1]);
		expect(raws[raws.length - 1]).toBeLessThan(raws[0] / 3);
	});

	it('redundant storage scales with depth', () => {
		const amp = (depth: number) => {
			const doc = parse(generateDeepNested(depth, 10_000, 7));
			return containerRawBytes(doc.children) / docByteLength(doc);
		};
		expect(amp(10)).toBeGreaterThan(amp(4));
	});

	it('exact output pinned', () => {
		expect(generateDeepNested(3, 40, 7)).toMatchInlineSnapshot(`
			"> foxtrot echo india echo papa delta
			>
			> - lima echo charlie mike india delta
			>
			>   > lima india golf hotel delta india
			>   >
			>   > alpha alpha papa
			"
		`);
	});
});
