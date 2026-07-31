// The container factory spreads `base.blockEdit` but replaces `base.focus` wholesale:
// harmless while the overrides return only a `blockEdit` key, and a silent drop of
// every focus override the day one grows. Nothing else binds the two lines.
import { describe, it, expect, vi } from 'vitest';
import {
	composeCollapseGates,
	type NestedActionsOverrides
} from '$lib/editor-actions/plugin/container';

const gates = { descendToBody: vi.fn(), moveFocus: vi.fn() };

describe('collapse gates layer onto the base override map', () => {
	it('keeps base members on every surface the gates also touch', () => {
		const baseSplit = vi.fn();
		const baseReveal = vi.fn();
		const base: NestedActionsOverrides = {
			blockEdit: { splitBlock: baseSplit },
			focus: { revealPath: baseReveal }
		};

		const composed = composeCollapseGates(base, gates);

		expect(composed.blockEdit?.splitBlock).toBe(baseSplit);
		expect(composed.focus?.revealPath).toBe(baseReveal);
		expect(composed.blockEdit?.descendToBody).toBe(gates.descendToBody);
		expect(composed.focus?.moveFocus).toBe(gates.moveFocus);
	});

	it('keeps surfaces the gates do not touch', () => {
		const containerEdit = { nudgeReactivity: vi.fn() };
		const composed = composeCollapseGates({ containerEdit }, gates);

		expect(composed.containerEdit).toBe(containerEdit);
	});

	it('gates win over a base member of the same name', () => {
		const composed = composeCollapseGates(
			{ blockEdit: { descendToBody: vi.fn() }, focus: { moveFocus: vi.fn() } },
			gates
		);

		expect(composed.blockEdit?.descendToBody).toBe(gates.descendToBody);
		expect(composed.focus?.moveFocus).toBe(gates.moveFocus);
	});
});
