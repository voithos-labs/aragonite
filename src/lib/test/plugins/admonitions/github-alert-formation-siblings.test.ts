import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, serialize } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { parseConverges } from '$lib/testing/parse-convergence';
import { containerAt, typeSlowly } from './formation-harness';

// The sibling gestures that reach the same container kind re-derivation as typing:
// a paste whose text spans blocks (the structural arm of the content commit, so the
// re-derivation runs inside the commit ceremony rather than the routine spine write),
// and the history round trip across the formation.

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
