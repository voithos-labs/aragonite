import { describe, it, expect, beforeEach } from 'vitest';
import { parse as parseDoc, serialize } from '#lib';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { parseConverges } from '#lib/testing/parse-convergence.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { containerAt, typeSlowly } from './formation-harness';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { ALERT, admonitionsGrammar } from '#lib/test/support/admonitions-grammar.js';

// The other actions that reach the same kind re-derivation as typing: a paste spanning blocks,
// whose re-derivation runs inside the commit rather than the ordinary write up the ancestors,
// and an undo/redo round trip across the formation.

let grammar: ReturnType<typeof admonitionsGrammar>;
const parse = (source: string) => parseDoc(source, { grammar });

beforeEach(() => {
	grammar = admonitionsGrammar();
});

describe('github alert: formation through sibling paths', () => {
	it('forms from a multi-block paste into the blockquote body', async () => {
		const h = containerAt('> x\n', [0], grammar);

		await h.bundle.blockEdit.updateBlockContent(
			0,
			'[!TIP]\n\nbody\n',
			'authored',
			'join-typing',
			1,
			13
		);

		const alert = h.getNode();
		expect(alert.kind).toBe(ALERT);
		expect(serialize(h.deps.doc)).toBe('> [!TIP]\n>\n> body\n');
		expect(parseConverges(h.deps.doc, grammar)).toBe(true);
	});

	// Only a metadata write can demote an alert, and a top-level commit rebuilds no ancestors,
	// so the kind re-derivation has to reach the metadata update directly.
	it('demotes a top-level alert whose type metadata stops naming an alert', async () => {
		const harness = makeEditorActionsDeps(parse('> [!TIP]\n> body\n').children, {
			reading: fixtureReading({ grammar })
		});
		const actions = createBlockEditActions(harness.deps, createUndoController(harness.deps));

		await actions.updateBlockMetadata(0, { alertType: 'NOPE' });

		expect(harness.deps.doc.children[0].kind).toBe('blockquote');
		expect(serialize(harness.deps.doc)).toBe('> [!NOPE]\n> body\n');
		expect(parseConverges(harness.deps.doc, grammar)).toBe(true);
	});

	it('round-trips the formation through undo and redo', async () => {
		const h = containerAt('> [!TI\n', [0], grammar);
		await typeSlowly(h.bundle, 0, '[!TI', 'P]');
		expect(h.getNode().kind).toBe(ALERT);

		await h.history.requestUndo();

		expect(h.deps.doc.children[0].kind).toBe('blockquote');
		expect(serialize(h.deps.doc)).toBe('> [!TI\n');
		expect(parseConverges(h.deps.doc, grammar)).toBe(true);

		await h.history.requestRedo();

		expect(h.deps.doc.children[0].kind).toBe(ALERT);
		expect(serialize(h.deps.doc)).toBe('> [!TIP]\n>\n');
		expect(parseConverges(h.deps.doc, grammar)).toBe(true);
	});
});
