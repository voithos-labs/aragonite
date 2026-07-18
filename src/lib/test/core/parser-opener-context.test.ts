import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../core/parser';
import { registerBlockOpener, type OpenContext } from '../../schema/block-openers';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { resetEditorEnv } from '../../env';

// parseBlocks once minted one OpenContext and re-stamped it each iteration, so an
// opener that retained the handle saw it mutate under the next block's parse. The
// contract is now unrepresentable-by-value: a fresh context per block. This pins
// the property a comment alone can't — a probe opener declines every block (so
// real parsing proceeds) while stashing each context it is offered. Under the old
// shared-and-re-stamped design both assertions fail: the stashed refs alias one
// object (distinctness collapses to size 1) that holds only the final block's
// fields (each retained context mismatches the block it was offered for).

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

		// Non-vacuity: three plain paragraphs, three distinct offers — without this
		// the distinctness assertion below would pass on a single offer (1 === 1).
		expect(doc.children).toHaveLength(3);
		expect(stashed).toHaveLength(3);

		// (a) distinct objects — a shared re-stamped context collapses this to 1.
		expect(new Set(stashed).size).toBe(stashed.length);

		// (b) each stashed context still describes the block it was offered for — a
		// shared handle would hold only the final iteration's index/line.
		stashed.forEach((ctx, i) => {
			expect(ctx.index).toBe(offeredFor[i].index);
			expect(ctx.line.text).toBe(offeredFor[i].text);
		});
	});
});
