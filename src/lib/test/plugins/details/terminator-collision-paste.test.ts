// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { checkOpaqueStaleRaw } from '$lib/invariants/node-shape';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { replaceBlockAtParent } from '$lib/tree-operations/paste/replace-block-at-parent';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '$lib/tree-operations/paste-surfaces';
import { __getDefaultTextSurface } from '$lib/tree-operations/paste/hooks';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit
} from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

// Miss-analysis: every terminator-collision suite drove the node-ops byte sinks (typing,
// split, cross-block delete); paste builds its nodes upstream of every sink, and no test
// drove pasteDispatch or the paste splice into a bodyWrite container (GH #40).

const OPEN_DETAILS = '<details>\n<summary>T</summary>\n\nbody\n\n</details>\n';

beforeEach(() => {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerDetailsKind();
	registerPasteSurface(__getDefaultTextSurface('paragraph'));
});

function mountDoc(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createPasteCoordinator(
		createUndoController(harness.deps),
		harness.deps.revealPath
	);
	const container = harness.deps.doc.children[0];
	if (container.children) {
		registerBlockListState(
			container,
			makeBlockListState(() => harness.deps.doc.children[0])
		);
	}
	return { ...harness, controller };
}

type Mounted = ReturnType<typeof mountDoc>;

async function paste(h: Mounted, pastedText: string, targetPath: number[], offset: number) {
	await pasteDispatch(
		{ pastedText, targetPath, offset },
		{ doc: h.doc, blockEdit: makeStubBlockEdit(), controller: h.controller }
	);
}

describe('details terminator escape at the paste door', () => {
	it('a structural paste bearing a stray terminator keeps the container and escapes it', async () => {
		const h = mountDoc(OPEN_DETAILS);

		await paste(h, 'intro\n\n</details>\n\nmore\n', [0, 1], 4);

		expect(parse(serialize(h.doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(serialize(h.doc)).toContain('&lt;/details>');
		expect(checkOpaqueStaleRaw(h.doc.children[0])).toBeNull();
	});

	// The target's OWN bytes strand, not the clipboard's: the paste's split is the same cut
	// the Enter door escapes, so the paste splice owes the same rule (split-door parity).
	it('a structural paste splitting a mid-line tag escapes the stranded half', async () => {
		const h = mountDoc('<details>\n<summary>T</summary>\n\nxx</details>\n\n</details>\n');
		expect(h.doc.children[0].children?.length).toBe(2);

		await paste(h, 'A\n\nB\n', [0, 1], 2);

		expect(parse(serialize(h.doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(serialize(h.doc)).toContain('&lt;/details>');
		expect(checkOpaqueStaleRaw(h.doc.children[0])).toBeNull();
	});

	// A balanced pair is legal markup the container's depth scan already handles; escaping
	// it would rewrite the user's example instead of nesting it.
	it('a pasted balanced details example nests verbatim, unescaped', async () => {
		const h = mountDoc(OPEN_DETAILS);
		const nested = '<details>\n<summary>x</summary>\n\nnested\n\n</details>\n';

		await paste(h, nested, [0, 1], 4);

		expect(h.doc.children[0].children?.some((c) => c.kind === 'details')).toBe(true);
		expect(serialize(h.doc)).toContain('<summary>x</summary>');
		expect(parse(serialize(h.doc)).children.map((c) => c.kind)).toEqual(['details']);
	});

	// The recognizer never sees an indented close, so the container survives in aragonite
	// either way — but a browser closes the element on it, and paste is the only door such
	// spellings can arrive through (GH #40).
	it('escapes a passthrough-only spelling arriving by paste', async () => {
		const h = mountDoc(OPEN_DETAILS);

		await paste(h, 'a\n\n </details>\n', [0, 1], 4);

		expect(serialize(h.doc)).toContain(' &lt;/details>');
		expect(parse(serialize(h.doc)).children.map((c) => c.kind)).toEqual(['details']);
	});

	it('leaves clipboard bytes alone when no ancestor declares a body grammar', async () => {
		const h = mountDoc('plain\n\nafter\n');

		await paste(h, 'x\n\n</details>\n', [0], 5);

		expect(serialize(h.doc)).toContain('</details>');
		expect(serialize(h.doc)).not.toContain('&lt;');
	});

	it('the splice sink escapes an htmlBlock terminator and re-derives its kind', async () => {
		const h = mountDoc(OPEN_DETAILS);

		await replaceBlockAtParent({
			doc: h.doc,
			blockPath: [0, 1],
			replacement: [{ kind: 'htmlBlock', leadingTrivia: '', raw: '</details>\n' } as CstNode],
			controller: h.controller,
			undoEntry: 'join',
			focusReplacementIndex: 0,
			focusOffset: 0,
			source: 'paste-dispatch'
		});

		const child = h.doc.children[0].children?.[1];
		expect(child?.raw).toBe('&lt;/details>\n');
		expect(child?.kind).toBe('paragraph');
	});
});
