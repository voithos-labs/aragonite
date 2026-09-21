import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parseConverges } from '$lib/testing/parse-convergence';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { containerAt, typeSlowly } from './formation-harness';

// The other actions that reach the same kind re-derivation as typing: a paste spanning blocks,
// whose re-derivation runs inside the commit rather than the ordinary write up the ancestors,
// and an undo/redo round trip across the formation.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('github alert — formation through sibling paths', () => {
	it('forms from a multi-block paste into the blockquote body', async () => {
		const h = containerAt('> x\n', [0]);

		await h.bundle.blockEdit.updateBlockContent(0, '[!TIP]\n\nbody\n', 1, 13);

		const alert = h.getNode();
		expect(alert.kind).toBe('githubAlert');
		expect(serialize(h.deps.doc)).toBe('> [!TIP]\n>\n> body\n');
		expect(parseConverges(h.deps.doc)).toBe(true);
	});

	// The marker comes from metadata, so only a metadata write can demote an alert. Top level
	// on purpose: that commit takes the document branch, which rebuilds no ancestors, so the
	// re-derivation has to reach the metadata update directly.
	it('demotes a top-level alert whose type metadata stops naming an alert', async () => {
		const harness = makeEditorActionsDeps(parse('> [!TIP]\n> body\n').children);
		const actions = createBlockEditActions(harness.deps, createUndoController(harness.deps));

		await actions.updateBlockMetadata(0, { alertType: 'NOPE' });

		expect(harness.deps.doc.children[0].kind).toBe('blockquote');
		expect(serialize(harness.deps.doc)).toBe('> [!NOPE]\n> body\n');
		expect(parseConverges(harness.deps.doc)).toBe(true);
	});

	it('round-trips the formation through undo and redo', async () => {
		const h = containerAt('> [!TI\n', [0]);
		await typeSlowly(h.bundle, 0, '[!TI', 'P]');
		expect(h.getNode().kind).toBe('githubAlert');

		await h.history.requestUndo();

		expect(h.deps.doc.children[0].kind).toBe('blockquote');
		expect(serialize(h.deps.doc)).toBe('> [!TI\n');
		expect(parseConverges(h.deps.doc)).toBe(true);

		await h.history.requestRedo();

		expect(h.deps.doc.children[0].kind).toBe('githubAlert');
		expect(serialize(h.deps.doc)).toBe('> [!TIP]\n>\n');
		expect(parseConverges(h.deps.doc)).toBe(true);
	});
});
