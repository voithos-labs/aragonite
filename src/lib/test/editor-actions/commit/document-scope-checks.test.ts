// @vitest-environment jsdom
// Miss-analysis: the wiring suite checked container scopes and the old document branch, never a
// multi-scope commit over the document itself, the one scope whose owner is not a block.

import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { assignChildIdsDeep } from '$lib/block-id';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { drainDevWarns, takeDevWarns } from '$lib/test/support/warn-gate';
import { makeKeydownEnv, press } from '../../selection/cross-block/keydown-env';

const firesStaleRaw = (): boolean =>
	takeDevWarns().some((fire) => fire.tag === 'invariant:stale-raw');

/** A quote whose nested quote's bytes no longer match its children, which no rebuild of the
 *  outer quote repairs. */
function withStaleNestedQuote(quote: CstNode): CstNode {
	const nested = quote.children?.find((child) => child.kind === 'blockquote');
	if (!nested) throw new Error('fixture has no nested blockquote');
	nested.raw = '> DESYNCED\n';
	return quote;
}

describe('a commit over the document scope checks the top-level blocks it wrote', () => {
	it('checks a block it spliced in', async () => {
		const { deps } = makeEditorActionsDeps(parse('head\n\ntail\n').children);
		const controller = createUndoController(deps);
		const stale = withStaleNestedQuote(parse('> outer\n>\n> > nested\n').children[0]);
		assignChildIdsDeep(stale);

		drainDevWarns();
		await controller.commitMultiScope({
			scopes: [controller.getDocScope()],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([doc]) => {
				doc.children.splice(0, 1, stale);
				return [{ op: 'replace', at: 0, count: 1, newCount: 1, idMap: { 0: 0 } }];
			},
			op: { kind: 'delete', eventPath: asDocPath([0]) }
		});

		expect(firesStaleRaw(), 'expected an invariant:stale-raw fire').toBe(true);
	});

	// The toggle rewrites leaves in place and reports no splice, so the change names no block.
	it('checks a block a cross-block format toggle rewrote in place', async () => {
		const env = makeKeydownEnv('head\n\n> > nested one\n> > nested two\n>\n> outer\n\ntail\n');
		withStaleNestedQuote(env.deps.doc.children[1]);
		env.selection.enterCrossBlock({ path: [1, 1], offset: 0 }, { path: [2], offset: 4 });

		drainDevWarns();
		await env.keydown.handleKeyDown(press('b', { ctrlKey: true }));

		expect(env.source()).toContain('**outer**');
		expect(firesStaleRaw(), 'expected an invariant:stale-raw fire').toBe(true);
	});
});
