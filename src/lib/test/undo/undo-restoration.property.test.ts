// @vitest-environment jsdom
// (cross-block range-delete entries capture a cross-block selection; restoring
// one routes through window.getSelection.)

/**
 * Structural-sharing undo keystone: random op sequences over real action
 * factories (top-level + nested chains + multi-scope list ops + table ops +
 * cross-block range deletes), then undo-all — every intermediate undo must
 * restore the serialization recorded at that entry's push, byte-exactly. A
 * single missed copy-path-on-write (a write through a snapshot-shared node)
 * corrupts an entry and fails the comparison. Op vocabulary + driver live in
 * restoration-ops.ts.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serialize } from '../../core/serializer';
import { arbOp, arbSource, makeHarness, runOp } from './restoration-ops';

const PARAMS = { numRuns: 40, seed: 20260611 } as const;

describe('undo restoration property (structural sharing)', () => {
	it('after N random ops, every undo step restores its push-time serialization byte-exactly', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbSource,
				fc.array(arbOp, { minLength: 1, maxLength: 8 }),
				async (source, ops) => {
					const h = makeHarness(source);
					const original = serialize(h.deps.doc);
					// Each undo entry snapshots the pre-op state of the op that
					// pushed it; record one expectation per stack-depth increase.
					const expected: string[] = [];

					for (const op of ops) {
						const before = serialize(h.deps.doc);
						await runOp(h, op);
						while (expected.length < h.deps.undoManager.getStacks().undo.length) {
							expected.push(before);
						}
					}

					for (let depth = h.deps.undoManager.getStacks().undo.length; depth > 0; depth--) {
						await h.history.requestUndo();
						expect(serialize(h.deps.doc)).toBe(expected[depth - 1]);
					}
					expect(serialize(h.deps.doc)).toBe(original);
				}
			),
			PARAMS
		);
	});
});
