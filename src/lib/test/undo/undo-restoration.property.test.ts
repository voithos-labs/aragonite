// @vitest-environment jsdom
// (cross-block range-delete entries capture a cross-block selection; restoring
// one routes through window.getSelection.)

/**
 * The main test for structural sharing in undo: random sequences of operations over the real
 * action factories with undo and redo mixed in, since one missed copy-before-write corrupts one
 * entry and only a byte comparison catches it. The comparison runs at the final state only: a
 * split mid-paragraph may legally serialize as one paragraph after a single operation, so only
 * the fully unwound state catches a restore whose bytes are right but whose structure drifted.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serialize } from '../../core/serializer';
import { parseConverges } from '../../testing/parse-convergence';
import { freshOrFixedSeed } from '../invariants/arbitraries';
import {
	arbOp,
	arbSource,
	makeHarness,
	runOp,
	MARKDOWN_TYPE_CHARS,
	typeCharCodePointOffset,
	type Op
} from './restoration-ops';

const PARAMS = { numRuns: 40, seed: freshOrFixedSeed(20260611) } as const;

describe('undo restoration property (structural sharing)', () => {
	it('every undo/redo step restores its captured serialization byte-exactly', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbSource,
				fc.array(arbOp, { minLength: 1, maxLength: 12 }),
				async (source, ops) => {
					const h = makeHarness(source);
					const original = serialize(h.deps.doc);
					const stacks = () => h.deps.undoManager.getStacks();

					// Each stack entry is modelled as the text it restores to: a push records the state
					// before the operation, and undo or redo moves it onto the other stack.
					const expectedUndo: string[] = [];
					const expectedRedo: string[] = [];

					for (const op of ops) {
						const before = serialize(h.deps.doc);
						const undoLenBefore = stacks().undo.length;
						const redoLenBefore = stacks().redo.length;
						await runOp(h, op);

						if (op.t === 'undo') {
							if (stacks().undo.length < undoLenBefore) {
								expect(serialize(h.deps.doc)).toBe(expectedUndo.pop());
								expectedRedo.push(before);
							}
						} else if (op.t === 'redo') {
							if (stacks().redo.length < redoLenBefore) {
								expect(serialize(h.deps.doc)).toBe(expectedRedo.pop());
								expectedUndo.push(before);
							}
						} else {
							const pushed = stacks().undo.length - undoLenBefore;
							if (pushed > 0) {
								expectedRedo.length = 0; // a fresh edit clears the redo stack
								for (let k = 0; k < pushed; k++) expectedUndo.push(before);
							}
						}
					}

					// The model tracked the real stacks in lockstep.
					expect(expectedUndo.length).toBe(stacks().undo.length);
					expect(expectedRedo.length).toBe(stacks().redo.length);

					// Phase A: undo everything back to the original source.
					while (stacks().undo.length > 0) {
						const before = serialize(h.deps.doc);
						const target = expectedUndo.pop()!;
						await h.history.requestUndo();
						expect(serialize(h.deps.doc)).toBe(target);
						expectedRedo.push(before);
					}
					expect(serialize(h.deps.doc)).toBe(original);

					// Phase B: redo everything back up. A random redo mid-run almost never lands on a
					// non-empty redo stack, so this phase is what tests redo.
					while (stacks().redo.length > 0) {
						const before = serialize(h.deps.doc);
						const target = expectedRedo.pop()!;
						await h.history.requestRedo();
						expect(serialize(h.deps.doc)).toBe(target);
						expectedUndo.push(before);
					}

					// Phase C: unwind once more to the original.
					while (stacks().undo.length > 0) {
						const target = expectedUndo.pop()!;
						await h.history.requestUndo();
						expect(serialize(h.deps.doc)).toBe(target);
					}
					expect(serialize(h.deps.doc)).toBe(original);
					expect(parseConverges(h.deps.doc)).toBe(true);
				}
			),
			PARAMS
		);
	});

	// A self-test: a generator that cannot produce the shape it is meant to stress proves nothing
	// about it.
	it('generates interior-offset marker typing and undo/redo ops', () => {
		const samples = fc.sample(fc.array(arbOp, { minLength: 1, maxLength: 12 }), {
			numRuns: 300,
			seed: 424242
		});
		const flat: Op[] = samples.flat();

		expect(flat.some((o) => o.t === 'undo')).toBe(true);
		expect(flat.some((o) => o.t === 'redo')).toBe(true);

		const typeChars = flat.filter((o): o is Extract<Op, { t: 'typeChar' }> => o.t === 'typeChar');
		expect(typeChars.length).toBeGreaterThan(0);

		// Resolve each generated offset against a fixed 8-code-point body: at least one has to land
		// strictly inside, neither at offset 0 nor at the end.
		const body = 'bodyword';
		const interior = typeChars.filter((o) => {
			const at = typeCharCodePointOffset(body, o.off);
			return at > 0 && at < body.length;
		});
		expect(interior.length).toBeGreaterThan(0);

		// The alphabet is Markdown-significant, not neutral filler.
		expect(MARKDOWN_TYPE_CHARS).toContain('|');
		expect(MARKDOWN_TYPE_CHARS).toContain('>');
	});
});
