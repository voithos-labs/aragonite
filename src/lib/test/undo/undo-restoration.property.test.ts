// @vitest-environment jsdom
// (cross-block range-delete entries capture a cross-block selection; restoring
// one routes through window.getSelection.)

/**
 * Structural-sharing undo keystone: random op sequences over real action
 * factories (top-level + nested chains + multi-scope list ops + table ops +
 * cross-block range deletes + Markdown-char typing at arbitrary offsets), with
 * `undo`/`redo` interleaved INTO the walk. Every undo restores the serialization
 * captured when its entry was pushed; every redo restores the live state captured
 * at the undo that spawned it — both byte-exactly. A single missed copy-path-on-
 * write corrupts an entry and fails the comparison.
 *
 * Convergence cadence: SETTLED endpoint only, not per-op. A mid-paragraph split
 * intentionally leaves two adjacent blocks that serialize as one paragraph (a
 * soft split — block-edit-core.test.ts), a legal live-tree-vs-raw divergence the
 * oracle flags but which is not corruption; the sim runs the oracle at checkpoint
 * cadence for the same reason. The drained endpoint IS settled (= original), so
 * asserting convergence there catches a restored tree whose bytes are right but
 * whose live kind/structure drifted (the join-paste-stale-kind class the byte
 * comparison is blind to).
 *
 * Case budget: numRuns 40 × up to 12 ops. The 12-op ceiling (was 8) buys room for
 * undo/redo interleaving to reach non-trivial stack depths without blowing the
 * unit budget.
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

					// Each stack entry, modelled as the serialization it restores TO when
					// applied. A push records the pre-op state; undo/redo move the live
					// pre-swap state onto the opposite stack (undoManager.undo/redo store
					// `currentState` as the inverse entry).
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

					// Drain phase A — undo everything down to the original source.
					while (stacks().undo.length > 0) {
						const before = serialize(h.deps.doc);
						const target = expectedUndo.pop()!;
						await h.history.requestUndo();
						expect(serialize(h.deps.doc)).toBe(target);
						expectedRedo.push(before);
					}
					expect(serialize(h.deps.doc)).toBe(original);

					// Drain phase B — redo everything back up. Random mid-walk redo ops
					// almost never land on a non-empty redo stack, so THIS phase is what
					// actually pins redo restoration: every entry undone above is redone
					// here and its forward target checked byte-exactly.
					while (stacks().redo.length > 0) {
						const before = serialize(h.deps.doc);
						const target = expectedRedo.pop()!;
						await h.history.requestRedo();
						expect(serialize(h.deps.doc)).toBe(target);
						expectedUndo.push(before);
					}

					// Drain phase C — unwind once more to the original.
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

	// Reachability self-test (house pattern): a generator that cannot reach the
	// class it is meant to stress proves nothing. Assert the sequences actually
	// produce interior-offset Markdown-char typing and redo replays.
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

		// Resolve each generated offset against a fixed 8-code-point body: at least
		// one must land strictly interior (not offset 0, not the end).
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
