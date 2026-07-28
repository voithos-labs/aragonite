import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin, FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';
import { rebuildFootnoteDefRaw } from '$lib/plugins/footnotes/footnote-definition';

// The definition is a strip container in the listItem mold: line 1's post-marker
// text plus dedented four-space continuations parse as real child blocks; the
// `[^label]: ` marker is pure syntax that lives only in the container's own raw,
// never in a child (so `strip(raw) === serialize(children)`).

describe('footnote definition strip decomposition', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('decomposes a single-line body into one paragraph child, marker stripped', () => {
		const def = parse('[^a]: hello world\n').children[0];
		expect(def.kind).toBe(FOOTNOTE_DEF_KIND);
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph']);
		// The marker is not part of any child — it belongs to the container raw.
		expect(def.children?.[0].raw).toBe('hello world\n');
	});

	it('folds an indented continuation into one paragraph child, dedented', () => {
		const def = parse('[^a]: one\n    two\n').children[0];
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph']);
		expect(def.children?.[0].raw).toBe('one\ntwo\n');
	});

	it('parses multi-block content: a blank-separated indented list is a second child', () => {
		const def = parse('[^a]: para\n\n    - item\n').children[0];
		expect(def.kind).toBe(FOOTNOTE_DEF_KIND);
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph', 'list']);
	});

	it('keeps the container raw byte-exact even though children hold stripped content', () => {
		const src = '[^long]: First line.\n    Continued, four spaces.\n';
		const def = parse(src).children[0];
		expect(def.raw).toBe(src);
		expect(def.children?.[0].raw).toBe('First line.\nContinued, four spaces.\n');
	});
});

describe('footnote definition rebuildRaw re-emits marker + continuation indent', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('re-emits marker + four-space indent after an inner edit', () => {
		const def = parse('[^a]: one\n    two\n').children[0];
		expect(def.children?.length).toBe(1);
		def.children![0].raw = 'ONE\nTWO\n';
		rebuildFootnoteDefRaw(def);
		expect(def.raw).toBe('[^a]: ONE\n    TWO\n');
	});

	it('reproduces a multi-block body, blank line unindented', () => {
		const def = parse('[^a]: para\n\n    - item\n').children[0];
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph', 'list']);
		rebuildFootnoteDefRaw(def);
		expect(def.raw).toBe('[^a]: para\n\n    - item\n');
	});

	it('preserves CRLF endings through the rebuild', () => {
		const def = parse('[^a]: one\r\n    two\r\n').children[0];
		expect(def.children?.length).toBe(1);
		def.children![0].raw = 'x\r\ny\r\n';
		rebuildFootnoteDefRaw(def);
		expect(def.raw).toBe('[^a]: x\r\n    y\r\n');
	});
});

// The definition's continuation scan and its body parse both ask the one
// blank-line predicate, so GFM §2.1 (space and tab only) reaches into the plugin:
// a non-breaking space is content on both.
describe('footnote definition treats a non-breaking space as content', () => {
	const NBSP = String.fromCharCode(0xa0);

	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('keeps an indented nbsp line inside one body paragraph', () => {
		const src = `[^a]: one\n    ${NBSP}\n    two\n`;
		const def = parse(src).children[0];
		expect(def.raw).toBe(src);
		expect(def.children?.map((c) => c.kind)).toEqual(['paragraph']);
		expect(def.children?.[0].raw).toBe(`one\n${NBSP}\ntwo\n`);
	});

	it('re-emits the indented nbsp line through a rebuild', () => {
		const src = `[^a]: one\n    ${NBSP}\n    two\n`;
		const def = parse(src).children[0];
		rebuildFootnoteDefRaw(def);
		expect(def.raw).toBe(src);
	});

	it('ends the definition at an unindented nbsp line', () => {
		// cmark-gfm would lazily continue the open paragraph here; this scan models
		// no lazy continuation (see docs/issues.md), so the definition closes and
		// the remaining lines are a sibling paragraph. Bytes are preserved either way.
		const doc = parse(`[^a]: one\n${NBSP}\n    two\n`);
		expect(doc.children.map((c) => c.kind)).toEqual([FOOTNOTE_DEF_KIND, 'paragraph']);
		expect(doc.children[0].raw).toBe('[^a]: one\n');
	});
});
