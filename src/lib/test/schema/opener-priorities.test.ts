/**
 * Keeps the published opener priorities in step with the registry: `OPENER_PRIORITIES` must
 * match the built-in openers the registry holds, in both directions. A new built-in opener that
 * skips the constant and a constant key with no registration are the same defect.
 */
import { describe, it, expect } from 'vitest';
import { openerRecords } from '../../schema/block-kind-descriptor';
import { OPENER_PRIORITIES } from '../../schema/opener-priorities';
import { isBuiltinBlockKind } from '../../core/nodes';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

describe('OPENER_PRIORITIES ↔ registry parity', () => {
	it('equals the built-in openers the registry holds after registration', () => {
		defaultGrammarView.orderedOpeners();
		const registered = Object.fromEntries(
			openerRecords()
				.filter((o) => isBuiltinBlockKind(o.key))
				.map((o) => [o.key, o.value.priority])
		);
		expect(registered).toEqual({ ...OPENER_PRIORITIES });

		// Non-vacuity: `paragraph` is a built-in with no opener, so a table listing it must not
		// match, the same way a built-in opener given a bare number instead of the constant fails.
		expect({ ...OPENER_PRIORITIES, paragraph: 5 }).not.toEqual(registered);
	});

	it('gives every built-in a distinct priority (a shared one is the tie the registry warns on)', () => {
		const values = Object.values(OPENER_PRIORITIES);
		expect(new Set(values).size).toBe(values.length);
	});
});
