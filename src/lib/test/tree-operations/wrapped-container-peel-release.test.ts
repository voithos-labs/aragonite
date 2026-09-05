import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/node-ops';
import { trailingLineEnding } from '$lib/core/lines';
import { rebuildAncestryRaw } from '$lib/schema/container-raw';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { installPlugins } from '$lib';
import { detailsPlugin } from '$lib/plugins/details';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';
import type { CstNode } from '$lib/core/nodes';

// The give-back twin of the closer-peel take pinned in `wrapped-container-separator.test.ts`: a
// blank run reaching the body tail borrows a line into `innerSuffix` so the reload keeps the
// block, and a tail that stops being blank owes that line back.
// Miss-analysis: the wrap arms were pinned in the blanking direction only, and the G2.13
// arbitrary draws no chrome-wrapped container, so nothing observed the return trip at all — the
// borrowed line simply stayed, one stray blank before every closer.

function writeBody(container: CstNode, at: number, text: string): void {
	updateNodeContent(
		{ children: container.children!, ownerKind: container.kind, owner: container },
		at,
		text
	);
	rebuildAncestryRaw(container, []);
}

const emptyBodyChild = (container: CstNode, at: number) =>
	writeBody(container, at, trailingLineEnding(container.children![at].raw));

describe('the closer peel a blank tail borrowed', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
	});
	afterEach(__resetSchemaRegistriesForTests);

	it('comes back when the emptied last body block is filled again', () => {
		const doc = parse(':::callout Title\nBody1\n\nBody2\n:::\n');
		const callout = doc.children[0];
		emptyBodyChild(callout, 2);
		expect(callout.innerSuffix).toBe('\n');

		writeBody(callout, 2, 'two\n');

		expect(callout.innerSuffix ?? '').toBe('');
		expect(serialize(doc)).toBe(':::callout Title\nBody1\n\ntwo\n:::\n');
		expectParseConverged(doc);
	});

	it('stays put when the block that fills is not the tail', () => {
		const doc = parse(':::callout Title\nBody1\n\nBody2\n:::\n');
		const callout = doc.children[0];
		emptyBodyChild(callout, 2);
		emptyBodyChild(callout, 1);

		writeBody(callout, 1, 'one\n');

		expect(callout.innerSuffix).toBe('\n');
		expectParseConverged(doc);
	});

	it('takes the CRLF document its own line endings', () => {
		const doc = parse(':::callout Title\r\nBody1\r\n\r\nBody2\r\n:::\r\n');
		const callout = doc.children[0];
		emptyBodyChild(callout, 2);

		writeBody(callout, 2, 'two\r\n');

		expect(serialize(doc)).toBe(':::callout Title\r\nBody1\r\n\r\ntwo\r\n:::\r\n');
		expectParseConverged(doc);
	});
});

// The gesture the class reaches production by: Enter at the end of the last body child makes a
// blank tail (the settle borrows), then typing fills it (the settle must give back). The take
// runs at the commit ceremony, so only a bundle-driven case crosses it.
describe('a tail split then typed, through the container bundle', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
		installPlugins([detailsPlugin()]);
	});
	afterEach(__resetSchemaRegistriesForTests);

	it('leaves no stray line before the closing fence', async () => {
		const h = makeNestedHarness(parse(':::callout Title\nFirst one\n:::\n'), { index: 0 });

		await h.bundle.blockEdit.splitBlock(1, 9);
		expectParseConverged(h.deps.doc);

		await h.bundle.blockEdit.updateBlockContent(2, 'two\n', 3);

		expect(serialize(h.deps.doc)).toBe(':::callout Title\nFirst one\n\ntwo\n:::\n');
		expect(h.getNode().children).toHaveLength(3);
		expectParseConverged(h.deps.doc);
	});

	// `<details>` is the other kind declaring `beforeCloserLine`, reaching the arm through a
	// different chrome shape: the wrap tier is the class, not the dogfood callout.
	it('holds for the details container too', async () => {
		const source = '<details>\n<summary>S</summary>\n\nFirst one\n\n</details>\n';
		const h = makeNestedHarness(parse(source), { index: 0 });
		const body = (h.getNode().children ?? []).length - 1;

		await h.bundle.blockEdit.splitBlock(body, 9);
		await h.bundle.blockEdit.updateBlockContent(body + 1, 'two\n', 3);

		// The seed's own blank against the closer is the peel by the time the tail run ends, so
		// it is spent with it: the release cannot tell an authored line from a borrowed one, and
		// the shape it leaves still reloads as itself.
		expect(serialize(h.deps.doc)).toBe(
			'<details>\n<summary>S</summary>\n\nFirst one\n\ntwo\n</details>\n'
		);
		expectParseConverged(h.deps.doc);
	});
});
