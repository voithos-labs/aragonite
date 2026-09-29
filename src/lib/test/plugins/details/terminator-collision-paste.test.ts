// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize, type CstNode } from '$lib';
import { checkOpaqueStaleRaw } from '$lib/invariants/node-shape';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';
import { defaultGrammarView } from '$lib/schema/block-openers';

// Miss-analysis: no test pasted into a bodyWrite container, only typed, split or deleted (GH #40).

const OPEN_DETAILS = '<details>\n<summary>T</summary>\n\nbody\n\n</details>\n';

beforeEach(() => {
	registerDetailsKind();
});

function mountDoc(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createPasteCoordinator(harness.deps, createUndoController(harness.deps));
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
		pasteContext({ doc: h.doc, blockEdit: makeStubBlockEdit(), controller: h.controller })
	);
}

describe('details terminator escape at the paste door', () => {
	it('a structural paste bearing a stray terminator keeps the container and escapes it', async () => {
		const h = mountDoc(OPEN_DETAILS);

		await paste(h, 'intro\n\n</details>\n\nmore\n', [0, 1], 4);

		expect(parse(serialize(h.doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(serialize(h.doc)).toContain('&lt;/details>');
		expect(checkOpaqueStaleRaw(h.doc.children[0], defaultGrammarView)).toBeNull();
	});

	// The target's own bytes are what get stranded, not the clipboard's: a paste splits at
	// the same point Enter does, so the paste splice has to apply the same escape.
	it('a structural paste splitting a mid-line tag escapes the stranded half', async () => {
		const h = mountDoc('<details>\n<summary>T</summary>\n\nxx</details>\n\n</details>\n');
		expect(h.doc.children[0].children?.length).toBe(2);

		await paste(h, 'A\n\nB\n', [0, 1], 2);

		expect(parse(serialize(h.doc)).children.map((c) => c.kind)).toEqual(['details']);
		expect(serialize(h.doc)).toContain('&lt;/details>');
		expect(checkOpaqueStaleRaw(h.doc.children[0], defaultGrammarView)).toBeNull();
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

	// The recognizer never sees an indented close, so the container survives here, but a browser
	// closes the element on it, and paste is the only way such spellings arrive.
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

		await h.controller.replaceBlock(
			[0, 1],
			[{ kind: 'htmlBlock', leadingTrivia: '', raw: '</details>\n' } as CstNode],
			{ replacementIndex: 0, offset: 0 },
			{ source: 'paste-dispatch', snapshotOffset: 0 }
		);

		const child = h.doc.children[0].children?.[1];
		expect(child?.raw).toBe('&lt;/details>\n');
		expect(child?.kind).toBe('paragraph');
	});
});
