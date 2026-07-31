/**
 * Parity guard for the published opener ladder: `OPENER_PRIORITIES` must equal the
 * built-in openers the registry holds, in both directions — a new built-in opener that
 * skips the constant, and a constant key with no registration, are the same defect.
 * Importing the parser is what registers the built-ins.
 */
import { describe, it, expect } from 'vitest';
import '../../core/parser';
import { listRegisteredOpeners } from '../../schema/block-openers';
import { OPENER_PRIORITIES } from '../../schema/opener-priorities';
import { isBuiltinBlockKind } from '../../core/nodes';

describe('OPENER_PRIORITIES ↔ registry parity', () => {
	it('equals the built-in openers the registry holds after registration', () => {
		const registered = Object.fromEntries(
			listRegisteredOpeners()
				.filter((o) => isBuiltinBlockKind(o.kind))
				.map((o) => [o.kind, o.priority])
		);
		expect(registered).toEqual({ ...OPENER_PRIORITIES });

		// Non-vacuity: `paragraph` is a built-in with no opener, so a table claiming it
		// must not match — the same way a built-in opener priced with a bare literal fails.
		expect({ ...OPENER_PRIORITIES, paragraph: 5 }).not.toEqual(registered);
	});

	it('gives every built-in a distinct priority (a shared one is the tie the registry warns on)', () => {
		const values = Object.values(OPENER_PRIORITIES);
		expect(new Set(values).size).toBe(values.length);
	});
});
