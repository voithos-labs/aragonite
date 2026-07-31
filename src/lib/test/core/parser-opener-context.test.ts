import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../core/parser';
import { registerBlockOpener, type OpenContext } from '../../schema/block-openers';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { resetEditorEnv } from '../../env';

// A re-stamped shared OpenContext mutates under an opener that retained the handle, so
// the contract is a fresh context per block. The probe declines every block, which lets
// real parsing proceed while it stashes each context it was offered.

describe('parser mints a fresh OpenContext per block', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());
	afterEach(() => resetEditorEnv());

	it('offers each block its own context, never a re-stamped shared handle', () => {
		const stashed: OpenContext[] = [];
		const offeredFor: { index: number; text: string }[] = [];
		const kind = declarePluginKind('context-probe');
		registerBlockOpener(kind, {
			priority: 1, // below every built-in: offered first, then declines to the real opener
			interruptsParagraph: false,
			tryOpen: (ctx) => {
				stashed.push(ctx);
				offeredFor.push({ index: ctx.index, text: ctx.line.text });
				return null;
			}
		});

		const doc = parse('alpha\n\nbeta\n\ngamma\n');

		// Non-vacuity: without this the distinctness assertion passes on a single offer.
		expect(doc.children).toHaveLength(3);
		expect(stashed).toHaveLength(3);

		// A shared re-stamped context collapses this to 1.
		expect(new Set(stashed).size).toBe(stashed.length);

		// A shared handle would hold only the final iteration's index/line.
		stashed.forEach((ctx, i) => {
			expect(ctx.index).toBe(offeredFor[i].index);
			expect(ctx.line.text).toBe(offeredFor[i].text);
		});
	});
});
