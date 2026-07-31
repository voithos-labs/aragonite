import { describe, expect, it } from 'vitest';
import type { CstNode } from '../../../core/nodes';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { docByteLength } from '../../../perf/instruments';
import { containerRawBytes } from '../container-raw-bytes';
import {
	FIXTURE_SHAPES,
	TRIGGER_DENSE_KINDS,
	generateFixture,
	generateTriggerDense,
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

	// Baseline numbers are keyed to these exact bytes, so a corpus edit must fail loudly
	// and force deliberate re-baselining. One pin per shape: inline snapshots need
	// distinct call sites, so a loop cannot carry them.
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

describe('generateTriggerDense', () => {
	for (const kind of TRIGGER_DENSE_KINDS) {
		it(`${kind}: deterministic for same seed, different for another`, () => {
			expect(generateTriggerDense(kind, 20_000, 7)).toBe(generateTriggerDense(kind, 20_000, 7));
			expect(generateTriggerDense(kind, 20_000, 7)).not.toBe(generateTriggerDense(kind, 20_000, 8));
		});

		it(`${kind}: round-trips losslessly`, () => {
			const src = generateTriggerDense(kind, 20_000, 7);
			expect(serialize(parse(src))).toBe(src);
		});

		// The rows measure a per-trigger cost, and only the viewport slice mounts, so
		// every paragraph has to carry the trigger for the density to be real.
		it(`${kind}: every paragraph carries the trigger`, () => {
			const doc = parse(generateTriggerDense(kind, 20_000, 7));
			const trigger = { 'bracket-footnote': '[', colon: ':', dollar: '$' }[kind];
			expect(doc.children.length).toBeGreaterThan(20);
			expect(doc.children.every((block) => block.raw.includes(trigger))).toBe(true);
		});
	}

	// A mounted reference re-derives from a whole-document walk, so the reference has to
	// be in block 0 — the caret's block, and the only one guaranteed mounted.
	it('bracket-footnote: block 0 carries a footnote reference and bracket density', () => {
		const doc = parse(generateTriggerDense('bracket-footnote', 20_000, 7));
		expect(doc.children[0].raw).toContain('[^fn-0]');
		expect(doc.children[0].raw.split('[').length - 1).toBeGreaterThanOrEqual(3);
	});

	// No definitions: numbering is by first-reference order, and `[^label]:` lines
	// would parse as link reference definitions on the rung-free control route.
	it('bracket-footnote: carries no footnote definitions', () => {
		expect(generateTriggerDense('bracket-footnote', 20_000, 7)).not.toMatch(/^\[\^/m);
	});

	it('dollar: one real math span, in the first paragraph only', () => {
		const md = generateTriggerDense('dollar', 20_000, 7);
		expect(md.split('$a + b$')).toHaveLength(2);
		expect(parse(md).children[0].raw).toContain('$a + b$');
	});

	it('exact output pinned', () => {
		expect(generateTriggerDense('bracket-footnote', 120, 7)).toMatchInlineSnapshot(`
			"alpha alpha papa lima india golf hotel delta [india lima](https://example.com/0) echo charlie mike india delta[^fn-0] foxtrot echo india echo papa delta [oscar delta][ref-0] charlie charlie echo india mike.

			"
		`);
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

	// Every level must carry sibling bytes: a spine-only tree passes the shape checks
	// above while silently understating the ancestry-rebuild tax the bench measures.
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
