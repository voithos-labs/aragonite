/**
 * Parity guard for the published opener ladder: `OPENER_PRIORITIES` (the plugin
 * barrel's constant, and the source the built-in registration sites consume) must
 * equal the built-in openers the registry actually holds. Importing the parser
 * registers the built-ins as a side effect; the registry read is filtered to
 * built-in kinds so a plugin opener from a leaked earlier registration can't
 * pollute the comparison. Bidirectional `toEqual` catches both a new built-in
 * opener that skips the constant and a constant key with no registration.
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

		// Non-vacuity: the comparison must discriminate. `paragraph` is a built-in
		// with no opener, so a table claiming it can't match the live registry — a
		// new built-in opener priced with a bare literal would fail here the same way.
		expect({ ...OPENER_PRIORITIES, paragraph: 5 }).not.toEqual(registered);
	});

	it('gives every built-in a distinct priority (a shared one is the tie the registry warns on)', () => {
		const values = Object.values(OPENER_PRIORITIES);
		expect(new Set(values).size).toBe(values.length);
	});
});
