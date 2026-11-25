import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib';
import { grammar as listing } from '#lib/plugin.js';
import { footnotes } from '#packages/footnotes/src/index.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { DEFINITION, footnotesGrammar } from '#lib/test/support/footnotes-grammar.js';

// The definition is a container shaped like a list item: its `[^label]: ` marker is syntax living
// only in the container's own raw, never in a child, which is what makes
// `strip(raw) === serialize(children)` hold.

let grammar: ReturnType<typeof footnotesGrammar>;
const read = (source: string) => parse(source, { grammar });

beforeEach(() => {
	grammar = footnotesGrammar();
});

describe('footnote definition strip decomposition', () => {
	it('decomposes a single-line body into one paragraph child, marker stripped', () => {
		const def = read('[^a]: hello world\n').children[0];
		expect(def.kind).toBe(DEFINITION);
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph']);
		// The marker is not part of any child; it belongs to the container's raw.
		expect(def.children?.[0].raw).toBe('hello world\n');
	});

	it('folds an indented continuation into one paragraph child, dedented', () => {
		const def = read('[^a]: one\n    two\n').children[0];
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph']);
		expect(def.children?.[0].raw).toBe('one\ntwo\n');
	});

	it('parses multi-block content: a blank-separated indented list is a second child', () => {
		const def = read('[^a]: para\n\n    - item\n').children[0];
		expect(def.kind).toBe(DEFINITION);
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph', 'list']);
	});

	it('keeps the container raw byte-exact even though children hold stripped content', () => {
		const src = '[^long]: First line.\n    Continued, four spaces.\n';
		const def = read(src).children[0];
		expect(def.raw).toBe(src);
		expect(def.children?.[0].raw).toBe('First line.\nContinued, four spaces.\n');
	});
});

describe('footnote definition rebuildRaw re-emits marker + continuation indent', () => {
	it('re-emits marker + four-space indent after an inner edit', () => {
		const def = read('[^a]: one\n    two\n').children[0];
		expect(def.children?.length).toBe(1);
		def.children![0].raw = 'ONE\nTWO\n';
		writeContainerRaw(def, grammar);
		expect(def.raw).toBe('[^a]: ONE\n    TWO\n');
	});

	it('reproduces a multi-block body, blank line unindented', () => {
		const def = read('[^a]: para\n\n    - item\n').children[0];
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph', 'list']);
		writeContainerRaw(def, grammar);
		expect(def.raw).toBe('[^a]: para\n\n    - item\n');
	});

	it('preserves CRLF endings through the rebuild', () => {
		const def = read('[^a]: one\r\n    two\r\n').children[0];
		expect(def.children?.length).toBe(1);
		def.children![0].raw = 'x\r\ny\r\n';
		writeContainerRaw(def, grammar);
		expect(def.raw).toBe('[^a]: x\r\n    y\r\n');
	});
});

// The definition's continuation scan and its body parse ask one blank-line predicate (GFM §2.1,
// space and tab only), so a non-breaking space is content on both.
describe('footnote definition treats a non-breaking space as content', () => {
	const NBSP = String.fromCharCode(0xa0);

	it('keeps an indented nbsp line inside one body paragraph', () => {
		const src = `[^a]: one\n    ${NBSP}\n    two\n`;
		const def = read(src).children[0];
		expect(def.raw).toBe(src);
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph']);
		expect(def.children?.[0].raw).toBe(`one\n${NBSP}\ntwo\n`);
	});

	it('re-emits the indented nbsp line through a rebuild', () => {
		const src = `[^a]: one\n    ${NBSP}\n    two\n`;
		const def = read(src).children[0];
		writeContainerRaw(def, grammar);
		expect(def.raw).toBe(src);
	});

	// Miss-analysis: the nbsp cases sat in the body only, so the label's JS `\s` went unseen.
	it('reads a nbsp inside the label as label text, and a tab as the end of the label', () => {
		const [def] = listing([footnotes]).parse(`[^a${NBSP}b]: x\n`).blocks;
		expect(def.type.name).toBe(DEFINITION);
		expect(def.data).toEqual({ label: `a${NBSP}b` });
		expect(def.children[0].text).toBe('x\n');
		expect(read('[^a\tb]: x\n').children[0].kind).toBe('paragraph');
	});

	it('continues the definition through an unindented nbsp line, lazily', () => {
		// Non-blank on both sides of the line: the scan takes it in as a lazy
		// continuation and the body parse keeps it in the one paragraph.
		const src = `[^a]: one\n${NBSP}\n    two\n`;
		const doc = read(src);
		expect(doc.children.map((c) => c.kind)).toEqual([DEFINITION]);
		expect(doc.children[0].raw).toBe(src);
	});
});
