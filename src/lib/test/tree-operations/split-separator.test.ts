// Enter mints the successor's blank-line separator when the first half would otherwise
// lazily absorb it. Asserted through `describeConvergence`, not bytes: the defect is the
// LIVE tree disagreeing with a reparse of its own serialization, which every byte-level
// oracle is blind to (the round trip is a tautology, G2.1).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitNode } from '../../tree-operations';
import { NEXT_PROSE_LINE, probeLineOpensAsProse } from '../../tree-operations/node-ops';
import { rebuildBlockquoteRaw } from '../../schema/container-rebuilders';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { registerBlockOpener } from '../../schema/block-openers';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { describeConvergence } from '../harness/parse-converged';
import { testClosure } from '$lib/test/support/closure';
import { takeDevWarns } from '$lib/test/support/warn-gate';

describe('split separator — the half that absorbs gets one', () => {
	it('Enter at the end of a paragraph, then typing, still reparses as two blocks', () => {
		const doc = parse('Hello world\n');
		splitNode(doc, 0, 'Hello world'.length, undefined, undefined, undefined);
		doc.children[1].raw = 'x\n';

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('Hello world\n\nx\n');
	});

	it('Enter mid-paragraph reparses as two blocks', () => {
		const doc = parse('Hello world\n');
		splitNode(doc, 0, 5, undefined, undefined, undefined);

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('Hello\n\n world\n');
	});

	it('the separator takes the block line ending, not a literal LF', () => {
		const doc = parse('Hello world\r\n');
		splitNode(doc, 0, 5, undefined, undefined, undefined);

		expect(doc.children[1].leadingTrivia).toBe('\r\n');
	});

	it('a blockquote child split reparses as two quoted paragraphs', () => {
		const doc = parse('> Risk noted,\n');
		const quote = doc.children[0];
		splitNode(
			{ children: quote.children!, ownerKind: quote.kind, owner: quote },
			0,
			'Risk noted,'.length,
			undefined,
			undefined,
			undefined
		);
		quote.children![1].raw = 'so we sequence it later.\n';
		rebuildBlockquoteRaw(quote);

		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(doc)).toBe('> Risk noted,\n>\n> so we sequence it later.\n');
	});
});

describe('split separator — the empty half that needs one', () => {
	// A lone blank line after a block is that block's trailing trivia, so an empty second
	// half only survives the reload as a block when a separator opens its run.
	const emptyHalfBecomesBlock: readonly [name: string, source: string, offset: number][] = [
		['heading', '## Title\n', 8],
		['thematic break', '---\n', 3],
		['setext heading', 'Title\n=====\n', 5]
	];

	for (const [name, source, offset] of emptyHalfBecomesBlock) {
		it(`${name}`, () => {
			const doc = parse(source);
			splitNode(doc, 0, offset, undefined, undefined, undefined);
			expect(doc.children[1].leadingTrivia).toBe('\n');
			expect(describeConvergence(doc)).toBeNull();
		});
	}
});

describe('split separator — the halves that close get none', () => {
	// A body that swallows a blank line as content would take the separator INSIDE itself,
	// which is why the predicate asks what a blank line DOES, not whether the join merges.
	const swallowsTheBlank: readonly [name: string, source: string, offset: number][] = [
		['unclosed fence', '```\ncode\n', 9],
		['unclosed html block', '<pre>\nliteral\n', 13]
	];

	for (const [name, source, offset] of swallowsTheBlank) {
		it(`${name}`, () => {
			const doc = parse(source);
			splitNode(doc, 0, offset, undefined, undefined, undefined);
			expect(doc.children[1].leadingTrivia).toBe('');
		});
	}

	it('an offset-0 split, whose first half is the empty placeholder', () => {
		const doc = parse('Hello\n');
		splitNode(doc, 0, 0, undefined, undefined, undefined);
		expect(doc.children[1].leadingTrivia).toBe('');
		expect(serialize(doc)).toBe('\nHello\n');
	});

	it('a successor already carrying the run’s separator', () => {
		const doc = parse('one\n\ntwo\n');
		splitNode(doc, 0, 3, undefined, undefined, undefined);
		expect(doc.children[1].leadingTrivia).toBe('');
		expect(serialize(doc)).toBe('one\n\n\ntwo\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});

describe('split separator — the promoted first half', () => {
	// Miss: the fresh property lane carves widened-delimiter-row docs out (#61's exclusion) and
	// this suite only cut halves that keep their kind, so nothing pinned a promote absorbing
	// the real head line where the prose stand-in survives.
	it('a half promoted to a table separates off the head its rows would absorb (#100)', () => {
		const doc = parse('| H0 | H1 |\n| --- | --- | --- |\n\n---\n');
		splitNode(doc, 0, 21, undefined, undefined, undefined);

		expect(doc.children[1].leadingTrivia).toBe('\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});

// The probe stands in for whatever the user types next, so it must be the line NO opener
// claims. Openers are arbitrary code, so a consumer's globally-registered plugin is the
// reachable way to break that, and unit files reset the platform.
describe('split separator — the probe line', () => {
	beforeEach(__resetSchemaRegistriesForTests);
	afterEach(__resetSchemaRegistriesForTests);

	it('is ordinary prose under the built-in grammar', () => {
		expect(probeLineOpensAsProse()).toBe(true);
	});

	it('is reported claimed when an opener takes it, and the mint is what is lost', () => {
		const kind = declarePluginKind('probe-claimer');
		registerBlockKind(kind, {
			gapEdges: 'none',
			mergeRole: 'not-mergeable',
			editable: false,
			supportsInline: false,
			closure: testClosure
		});
		registerBlockOpener(kind, {
			priority: 1,
			interruptsParagraph: () => true,
			tryOpen: (ctx) =>
				ctx.line.text === NEXT_PROSE_LINE
					? { node: { kind, leadingTrivia: '', raw: ctx.line.raw }, consumed: 1 }
					: null
		});

		expect(probeLineOpensAsProse()).toBe(false);

		// The consequence, pinned so the guard's warning is not the only record: a claimed probe
		// makes the separator read as doing nothing, and every paragraph split loses it.
		const doc = parse('Hello world\n');
		splitNode(doc, 0, 5, undefined, undefined, undefined);
		expect(doc.children[1].leadingTrivia).toBe('');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['tree-ops']);
	});
});
