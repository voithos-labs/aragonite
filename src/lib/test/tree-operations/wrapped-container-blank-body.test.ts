import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { updateNodeContent } from '#lib/tree-operations/content-write.js';
import { firstLineEnding, trailingLineEnding } from '#lib/core/lines.js';
import { rebuildAncestryRaw } from '#lib/schema/container-raw.js';
import { activateDirectiveGrammar } from '#lib/core/directive/activate.js';
import { makeNestedHarness } from '#lib/test/harness/editor-actions.js';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';
import type { CstNode } from '#lib/core/nodes.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { fixtureGrammar } from '#lib/test/harness/fixture-grammar.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';

// Emptying every body block of a fenced container leaves a blank run that is the whole body, and
// the reload strips a line into both `innerPrefix` and `innerSuffix`, so the run carries two lines.
// Miss-analysis: GH #130, every fence-line case had prose on one side of the run.

/** The emptied-block gesture through the container write: typing sends the ending alone. */
function emptyBodyChild(container: CstNode, at: number): void {
	updateNodeContent(
		{
			children: container.children!,
			owner: container,
			lineEnding: firstLineEnding(container.raw) ?? '\n'
		},
		at,
		trailingLineEnding(container.children![at].raw, '\n'),
		defaultGrammarView,
		createSharingState()
	);
	rebuildAncestryRaw(container, [], fixtureGrammar);
}

describe('a blank run that is the whole wrapped body', () => {
	beforeEach(() => {
		registerCalloutKind();
	});

	// Through the real write: emptying a paragraph is kind-stable, so both writes take the
	// routine typing path and the container's raw is rebuilt from the emptied body.
	it('survives emptying every body block through the content entry point', async () => {
		const h = makeNestedHarness(':::callout Title\nBody1\n\nBody2\n:::\n', { index: 0 });

		await h.bundle.blockEdit.updateBlockContent(1, '\n', 'authored', 0, 0);
		await h.bundle.blockEdit.updateBlockContent(2, '\n', 'authored', 0, 0);

		expect(serialize(h.deps.doc)).toBe(':::callout Title\n\n\n\n\n:::\n');
		expectParseConverged(h.deps.doc);
	});

	// The reload's own layout: both fence lines taken, and every surviving block carries its line
	// in its own raw rather than in `leadingTrivia` (`docs/design/syntax-tree.md` § Blank lines).
	it('lands the strips in the wrap slots and leaves nothing standing', () => {
		const doc = parse(':::callout Title\nBody1\n\nBody2\n:::\n');
		const callout = doc.children[0];

		emptyBodyChild(callout, 1);
		emptyBodyChild(callout, 2);

		expect(callout.innerPrefix).toBe('\n');
		expect(callout.innerSuffix).toBe('\n');
		expect(callout.children!.map((c) => [c.leadingTrivia, c.raw])).toEqual([
			['', 'Title\n'],
			['', '\n'],
			['', '\n']
		]);
		expectParseConverged(doc);
	});

	it('holds for a run of three, where each further block is one more line', () => {
		const doc = parse(':::callout Title\nB1\n\nB2\n\nB3\n:::\n');
		const callout = doc.children[0];

		for (const at of [1, 2, 3]) emptyBodyChild(callout, at);

		expect(serialize(doc)).toBe(':::callout Title\n\n\n\n\n\n:::\n');
		expectParseConverged(doc);
	});

	it('the CRLF variant hands over CRLF lines', () => {
		const doc = parse(':::callout Title\r\nBody1\r\n\r\nBody2\r\n:::\r\n');
		const callout = doc.children[0];

		emptyBodyChild(callout, 1);
		emptyBodyChild(callout, 2);

		expect(callout.innerPrefix).toBe('\r\n');
		expect(callout.innerSuffix).toBe('\r\n');
		expectParseConverged(doc);
	});
});

// A blockquote's body opens at the container's own first line, so nothing is stripped and a
// whole-blank body needs no fence line at all.
describe('a blank run that is the whole unwrapped body', () => {
	beforeEach(activateDirectiveGrammar);

	it('takes no wrap line: a blockquote strips nothing', () => {
		const doc = parse('> a\n>\n> b\n');
		const quote = doc.children[0];
		expect(quote.children!.map((c) => c.raw)).toEqual(['a\n', 'b\n']);

		emptyBodyChild(quote, 0);
		emptyBodyChild(quote, 1);

		expect(quote.innerPrefix ?? '').toBe('');
		expect(quote.innerSuffix ?? '').toBe('');
		expectParseConverged(doc);
	});
});
