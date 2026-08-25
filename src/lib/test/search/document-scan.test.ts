import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode, Document } from '$lib/core/nodes';
import { compileMatcher } from '$lib/search/matcher';
import { scanDocument } from '$lib/search/document-scan';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';

const matcherFor = (q: string) => {
	const r = compileMatcher(q, { caseSensitive: false, wholeWord: false, regex: false });
	if (!r.ok) throw new Error(r.error);
	return r.matcher;
};

const scan = (src: string, q: string) => scanDocument(parse(src), matcherFor(q));

describe('scanDocument', () => {
	it('finds matches in top-level leaves with correct paths and offsets', () => {
		const m = scan('hi cat\n\ncat there\n', 'cat');
		expect(m).toEqual([
			{ path: [0], start: 3, end: 6 },
			{ path: [1], start: 0, end: 3 }
		]);
	});
	it('descends into containers and keys matches by the leaf path', () => {
		const m = scan('> quoted cat\n', 'cat');
		expect(m.map((x) => x.path)).toEqual([[0, 0]]); // blockquote → paragraph
	});
	it('does NOT double-count container raw', () => {
		const m = scan('> cat\n', 'cat');
		expect(m.length).toBe(1); // only the inner paragraph, not the blockquote's raw
	});
	it('excludes ambient prefixes (list markers are not in leaf raw)', () => {
		const m = scan('- item\n', '- ');
		expect(m.length).toBe(0);
	});
	it('reaches table cells (table → tableRow → tableCell) without counting row/table raw', () => {
		const m = scan('| name | qty |\n| --- | --- |\n| cat | 2 |\n', 'cat');
		expect(m).toEqual([{ path: [0, 1, 0], start: 0, end: 3 }]);
	});
});

describe('scanDocument — childless opaque containers', () => {
	const docWith = (...children: CstNode[]): Document => ({
		kind: 'document',
		prefix: '',
		children,
		suffix: ''
	});
	const node = (kind: CstNode['kind'], raw: string, children?: CstNode[]): CstNode =>
		({
			kind,
			leadingTrivia: '',
			raw,
			children
		}) as CstNode;

	let diagram: CstNode['kind'];
	let artifact: CstNode['kind'];
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		diagram = declarePluginKind('scan-diagram');
		artifact = declarePluginKind('scan-artifact');
		const container = { contract: 'opaque' as const, rebuildRaw: () => {} };
		registerBlockKind(diagram, {
			gapEdges: 'none',
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container
		});
		registerBlockKind(artifact, {
			gapEdges: 'none',
			mergeRole: 'not-mergeable',
			editable: false,
			supportsInline: false,
			closure: testClosure,
			container
		});
	});

	it('scans a childless editable opaque container raw as a leaf', () => {
		const doc = docWith(node(diagram, '```mermaid\ngraph cat\n```\n', []));
		expect(scanDocument(doc, matcherFor('cat'))).toEqual([{ path: [0], start: 17, end: 20 }]);
	});

	it('an opaque container WITH children still walks children only (raw not double-counted)', () => {
		const doc = docWith(
			node(diagram, ':::cat\ncat body\n:::\n', [node('paragraph', 'cat body\n')])
		);
		expect(scanDocument(doc, matcherFor('cat'))).toEqual([{ path: [0, 0], start: 0, end: 3 }]);
	});

	it('a childless non-editable opaque container stays unscanned', () => {
		const doc = docWith(node(artifact, 'cat art\n', []));
		expect(scanDocument(doc, matcherFor('cat'))).toEqual([]);
	});

	it('an EMPTY strip container stays unscanned (its raw is marker bytes, not content)', () => {
		// These childless containers are editable, but their raw is ambient marker
		// syntax — scanning it resurrects the marker-match class the ambient rule kills.
		expect(scanDocument(parse('- \n'), matcherFor('- '))).toEqual([]);
		expect(scanDocument(parse('> \n'), matcherFor('>'))).toEqual([]);
	});
});
