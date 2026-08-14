import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/node-ops';
import { trailingLineEnding } from '$lib/core/lines';
import { rebuildAncestryRaw } from '$lib/schema/container-raw';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';
import type { CstNode } from '$lib/core/nodes';

// GH #130: emptying every body block of a chrome-wrapped container leaves a blank run that IS
// the whole body, and the reload peels a line into BOTH wrap slots before it materializes a
// block — so the run owes two lines, where each peel arm alone grants at most one.
// Miss-analysis: every peel case was pinned with prose on one side of the run, which is what
// each arm's own guard tests for, so the shape where neither arm engages had no pin.

/** The emptied-block gesture through the container sink: commitInput sends the ending alone. */
function emptyBodyChild(container: CstNode, at: number): void {
	updateNodeContent(
		{ children: container.children!, ownerKind: container.kind, owner: container },
		at,
		trailingLineEnding(container.children![at].raw)
	);
	rebuildAncestryRaw(container, []);
}

describe('a blank run that is the whole wrapped body', () => {
	beforeEach(() => {
		// registerChromeLeaf registers a paste surface, so the schema reset alone would leave
		// it orphaned and a re-register would collide.
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
	});
	afterEach(__resetSchemaRegistriesForTests);

	// Through the door: emptying a paragraph is kind-stable, so both writes take the routine
	// typing path and the container's raw is rebuilt from the emptied body.
	it('survives emptying every body block through the content door', async () => {
		const h = makeNestedHarness(':::callout Title\nBody1\n\nBody2\n:::\n', { index: 0 });

		await h.bundle.blockEdit.updateBlockContent(1, '\n', 0, 0);
		await h.bundle.blockEdit.updateBlockContent(2, '\n', 0, 0);

		expect(serialize(h.deps.doc)).toBe(':::callout Title\n\n\n\n\n:::\n');
		expectParseConverged(h.deps.doc);
	});

	// The reload's own layout: both peels taken, and every surviving block carries its line in
	// its own raw rather than in trivia (syntax-tree.md § Blank lines).
	it('lands the peels in the wrap slots and leaves nothing standing', () => {
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

	it('the CRLF twin hands over CRLF lines', () => {
		const doc = parse(':::callout Title\r\nBody1\r\n\r\nBody2\r\n:::\r\n');
		const callout = doc.children[0];

		emptyBodyChild(callout, 1);
		emptyBodyChild(callout, 2);

		expect(callout.innerPrefix).toBe('\r\n');
		expect(callout.innerSuffix).toBe('\r\n');
		expectParseConverged(doc);
	});
});

// Non-vacuity for the two-peel gate: a blockquote's body opens at the container's own first
// line, so nothing peels and a whole-blank body owes no wrap line at all.
describe('a blank run that is the whole UNWRAPPED body', () => {
	beforeEach(activateDirectiveGrammar);

	it('takes no wrap line — a blockquote peels nothing', () => {
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
