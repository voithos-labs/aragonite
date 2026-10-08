// The copied chain must be as deep as the leaf path, or the write lands on a node the undo
// snapshot shares and corrupts history at a later undo.
import { describe, it, expect, vi } from 'vitest';
import * as unshare from '#lib/tree-operations/unshare.js';
import { serialize } from '#lib/core/serializer.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { docPathFrom } from '#lib/cursor/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

vi.mock('#lib/tree-operations/unshare.js', async (original) => {
	const real = await original<typeof import('#lib/tree-operations/unshare.js')>();
	return { ...real, ensureUnsharedPath: vi.fn(real.ensureUnsharedPath) };
});

const SOURCE = '- a\n';

function typeAt(path: number[]) {
	const { deps } = makeEditorActionsDeps(SOURCE);
	const typing = createLeafTyping(deps, createUndoController(deps));
	const write = legalizeWrite(documentBody(deps.doc), 0, '- ab\n', 'authored');
	return { deps, result: typing.writeLeafInPlace(docPathFrom(path), write, 1) };
}

describe('G1.20 unshared ancestor-chain depth', () => {
	it('stays silent when the chain is as deep as the leaf path', () => {
		const { result } = typeAt([0, 0, 0]);

		expect(result.wrote).toBe(true);
		expect(takeDevWarns()).toEqual([]);
	});

	it('fires, and writes nothing, when the chain comes back short of the leaf path', () => {
		const { deps, result } = typeAt([0, 3, 0]);

		expect(result.wrote).toBe(false);
		expect(serialize(deps.doc)).toBe(SOURCE);
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual([
			'invariant:unshare-path-in-range',
			'invariant:unshared-spine-depth'
		]);
		expect(fires[1].message).toContain('chain depth 1 != leaf path depth 3');
	});

	// The predicate is an equality, not a lower bound: a `<` written where `!==` belongs would let
	// an over-long chain address the wrong ancestor.
	it('fires when the chain comes back deeper than the leaf path', () => {
		vi.mocked(unshare.ensureUnsharedPath).mockImplementationOnce((root, path, sharing) => {
			const chain = unshare.walkUnsharing(root, path, sharing, true);
			return [...chain, chain[chain.length - 1]];
		});

		const { result } = typeAt([0, 0, 0]);

		expect(result.wrote).toBe(false);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:unshared-spine-depth']);
	});
});
