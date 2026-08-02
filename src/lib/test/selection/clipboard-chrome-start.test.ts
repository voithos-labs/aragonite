import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../core/parser';
import { getPluginMetadata, type AnyBlockKind, type CstNode } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { collectCrossBlockText } from '../../selection/clipboard-text';
import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { augmentBlockKind } from '../../schema/block-kind-descriptor';
import { rebuildBlockquoteRaw } from '../../schema/container-rebuilders';
import {
	CALLOUT,
	registerCalloutKind,
	rebuildCalloutRaw
} from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import type { SelectionPoint } from '../../selection/primitives';

// A cross-block copy whose START lands inside a container's reserved chrome used to emit the
// chrome tail wrapper-less and the body flat, so the whole selection reparsed as bare paragraphs.

function point(path: number[], offset: number): SelectionPoint {
	return { path, offset };
}

function registerPlugins() {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerCalloutKind();
	registerDetailsKind();
}

const bodies = (node: CstNode) => node.children!.slice(1).map((c) => trimTrailingLineEnding(c.raw));
const title = (node: CstNode) => trimTrailingLineEnding(node.children![0].raw);

describe('cross-block copy starting in reserved chrome', () => {
	beforeEach(registerPlugins);

	// Pre-fix this yielded "tle\nBody1\n\nBody2\n\nBel".
	it('re-emits the truncated title as the opener and closes past the container', () => {
		const doc = parse(':::callout Title\n\nBody1\n\nBody2\n\n:::\n\nBelow\n');
		const text = collectCrossBlockText(doc, point([0, 0], 2), point([1], 3));

		expect(text).toBe(':::callout tle\n\nBody1\n\nBody2\n\n:::\n\nBel');
		const reparsed = parse(text);
		expect(reparsed.children.map((c) => c.kind)).toEqual(['callout', 'paragraph']);
		expect(title(reparsed.children[0])).toBe('tle');
		expect(bodies(reparsed.children[0])).toEqual(['Body1', 'Body2']);
	});

	it('closes the container at a body endpoint when the selection never leaves it', () => {
		const doc = parse(':::callout Title\n\nBody1\n\nBody2\n\n:::\n\nBelow\n');
		const text = collectCrossBlockText(doc, point([0, 0], 2), point([0, 2], 3));

		const reparsed = parse(text);
		expect(reparsed.children.map((c) => c.kind)).toEqual(['callout']);
		expect(bodies(reparsed.children[0])).toEqual(['Body1', 'Bod']);
	});

	it('keeps a body-less container from gaining a body', () => {
		const doc = parse(':::callout Title\n:::\n\nBelow\n');
		const text = collectCrossBlockText(doc, point([0, 0], 2), point([1], 3));

		expect(text).toBe(':::callout tle\n:::\n\nBel');
		expect(parse(text).children[0].children!.map((c) => c.kind)).toEqual(['callout-title']);
	});

	// G4.20: the closer's line ending comes off the live container's raw, not a
	// default — a CRLF-authored callout must not emit an LF closer.
	it('rebuilds a CRLF-authored container CRLF-safe', () => {
		const doc = parse(':::callout Title\r\n\r\nBody\r\n\r\n:::\r\n\r\nBelow\r\n');
		const text = collectCrossBlockText(doc, point([0, 0], 2), point([1], 3));

		expect(text).toBe(':::callout tle\r\n\r\nBody\r\n\r\n:::\r\n\r\nBel');
		const reparsed = parse(text);
		expect(reparsed.children.map((c) => c.kind)).toEqual(['callout', 'paragraph']);
		expect(bodies(reparsed.children[0])).toEqual(['Body']);
	});

	it('rebuilds a details from its summary tail, open flag preserved', () => {
		const doc = parse(
			'<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n\nBelow\n'
		);
		const text = collectCrossBlockText(doc, point([0, 0], 3), point([1], 3));

		const details = parse(text).children[0];
		expect(details.kind).toBe('details');
		expect(getPluginMetadata<{ open: boolean }>(details)?.open).toBe(true);
		expect(title(details)).toBe('mary');
		expect(bodies(details)).toEqual(['Body']);
	});

	it('carries a table through the container body untouched', () => {
		const doc = parse(':::callout Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n:::\n\nBelow\n');
		const text = collectCrossBlockText(doc, point([0, 0], 2), point([1], 3));

		const note = parse(text).children[0];
		expect(note.children!.map((c) => c.kind)).toEqual(['callout-title', 'table']);
		expect(note.children![1].raw).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
	});

	describe('nested containers', () => {
		const nested =
			'::::callout Outer\n\nO1\n\n:::callout Inner\n\nI1\n\n:::\n\nO2\n\n::::\n\nBelow\n';

		// The closer must match the OPENER's fence length: a constant ":::" would
		// close the outer at the inner container's closer line and strand O2.
		it('closes the outer at its own fence width, not a constant', () => {
			const doc = parse(nested);
			const text = collectCrossBlockText(doc, point([0, 0], 2), point([1], 3));

			expect(text.startsWith('::::callout ter\n')).toBe(true);
			const outer = parse(text).children[0];
			expect(title(outer)).toBe('ter');
			expect(outer.children!.map((c) => c.kind)).toEqual([
				'callout-title',
				'paragraph',
				'callout',
				'paragraph'
			]);
			expect(bodies(outer.children![2])).toEqual(['I1']);
		});

		// Start in the outer chrome, end in the inner chrome: the end-side synthesis
		// already yields a complete inner container, so both closers land in order.
		it('nests a chrome-only end container inside the opened outer', () => {
			const doc = parse(nested);
			const text = collectCrossBlockText(doc, point([0, 0], 2), point([0, 2, 0], 3));

			const outer = parse(text).children[0];
			expect(outer.children!.map((c) => c.kind)).toEqual(['callout-title', 'paragraph', 'callout']);
			expect(title(outer.children![2])).toBe('Inn');
			expect(bodies(outer.children![2])).toEqual([]);
		});

		// Start in the INNER chrome, running past the outer's end: only the container the start opened
		// may close, or a closer for the never-opened outer strands a bare "::::" line after the copy.
		it('closes only the container the start opened', () => {
			const doc = parse(nested);
			const text = collectCrossBlockText(doc, point([0, 2, 0], 2), point([1], 3));

			expect(text).toBe(':::callout ner\n\nI1\n\n:::\n\nO2\n\nBel');
			const reparsed = parse(text);
			expect(reparsed.children.map((c) => c.kind)).toEqual(['callout', 'paragraph', 'paragraph']);
			expect(title(reparsed.children[0])).toBe('ner');
			expect(bodies(reparsed.children[0])).toEqual(['I1']);
			expect(reparsed.children.slice(1).map((c) => trimTrailingLineEnding(c.raw))).toEqual([
				'O2',
				'Bel'
			]);
		});

		// Residue (issue #42): an end inside a nested container's BODY skips it in the walk, so its
		// bytes flatten to prose. The outer wrapper — this fix's contract — still survives.
		it('keeps the outer kind when the end lands in a nested body', () => {
			const doc = parse(nested);
			const text = collectCrossBlockText(doc, point([0, 0], 2), point([0, 2, 1], 1));

			const outer = parse(text).children[0];
			expect(outer.kind).toBe('callout');
			expect(title(outer)).toBe('ter');
			expect(bodies(outer)).toEqual(['O1\nInner\nI']);
		});
	});

	// The property the buffer-and-wrap design exists for: `colonCount` stays 4 in metadata while the
	// live fence widened to 5, so reading the fence from metadata alone closes the container early.
	it('widens opener and closer together when the body forces fence escalation', () => {
		const doc = parse('::::callout Title\n\n:::\n\n::::\n\nBelow\n');
		doc.children[0].children![1].raw = '::::\n';
		rebuildCalloutRaw(doc.children[0]);

		const text = collectCrossBlockText(doc, point([0, 0], 2), point([1], 3));

		expect(text.startsWith(':::::callout tle\n')).toBe(true);
		const reparsed = parse(text);
		expect(reparsed.children.map((c) => c.kind)).toEqual(['callout', 'paragraph']);
		expect(bodies(reparsed.children[0])).toEqual(['::::']);
	});

	// Where the grid and chrome arms actually meet: a sub-table emitted by the table
	// end arm flows into the wrapper as ordinary body bytes.
	it('wraps a sub-table emitted by a mid-table end endpoint', () => {
		const doc = parse(
			':::callout Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\n:::\n\nBelow\n'
		);
		const text = collectCrossBlockText(doc, point([0, 0], 2), {
			path: [0, 1],
			offset: 2,
			cellCoordinate: true
		});

		const note = parse(text).children[0];
		expect(note.kind).toBe('callout');
		expect(title(note)).toBe('tle');
		expect(note.children!.map((c) => c.kind)).toEqual(['callout-title', 'table']);
		expect(note.children![1].raw).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
	});

	// A container declaring reservedChrome on a `strip` contract has no closer to synthesize — its
	// syntax is a per-line prefix — so BOTH chrome paths must decline rather than emit a wrapper.
	it('declines wrapper synthesis on both endpoints for a strip-contract container', () => {
		const doc = parse('Above\n\n:::callout Title\n\nBody\n\n:::\n\nBelow\n');
		augmentBlockKind(CALLOUT as AnyBlockKind, {
			container: { contract: 'strip', rebuildRaw: rebuildBlockquoteRaw }
		});

		// Pre-guard the end arm emitted "ove\n> Tit" — a blockquote wrapper on a note.
		expect(collectCrossBlockText(doc, point([0], 2), point([1, 0], 3))).toBe('ove\nTit');
		expect(collectCrossBlockText(doc, point([1, 0], 2), point([2], 3))).toBe('tle\nBody\n\nBel');
	});
});
