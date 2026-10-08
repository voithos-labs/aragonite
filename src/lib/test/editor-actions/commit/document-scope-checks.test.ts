// @vitest-environment jsdom
// Miss-analysis: the wiring suite checked container scopes and top-level metadata writes, never a
// multi-scope commit over the document itself, the one scope whose owner is not a block.

import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode } from '#lib/core/nodes.js';
import type { ContainerScope } from '#lib/action-contracts.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import { ensureUnsharedChild, ensureUnsharedSubtree } from '#lib/tree-operations/unshare.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { asDocPath } from '#lib/selection/path-math.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { drainDevWarns, takeDevWarns } from '#lib/test/support/warn-gate.js';
import { makeKeydownEnv, press } from '../../selection/cross-block/keydown-env';

const firesStaleRaw = (): boolean =>
	takeDevWarns().some((fire) => fire.tag === 'invariant:stale-raw');

/** A quote whose nested quote's bytes don't match its children, which no rebuild of the outer
 *  quote repairs. */
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

	it('checks a block swapped in under a noop change', async () => {
		const { deps } = makeEditorActionsDeps(parse('head\n\ntail\n'));
		const controller = createUndoController(deps);
		const stale = withStaleNestedQuote(parse('> outer\n>\n> > nested\n').children[0]);
		assignChildIdsDeep(stale);

		drainDevWarns();
		await controller.commitMultiScope({
			scopes: [controller.getDocScope()],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([doc]) => {
				doc.children[0] = stale;
				return [{ op: 'noop' }];
			}
		});

		expect(firesStaleRaw(), 'expected an invariant:stale-raw fire').toBe(true);
	});

	// Miss: every row ran one commit, so a block the step already owned, written in place with no
	// copy and no position, never reached the check.
	it('checks a block an earlier commit in the same undo step copied', async () => {
		const { deps } = makeEditorActionsDeps(parse('> outer\n>\n> > nested\n\ntail\n'));
		const controller = createUndoController(deps);
		const snapshot = { path: asDocPath([0]), offset: 0 };
		const commitOverDocument = (write: (doc: ContainerScope) => void) =>
			controller.commitMultiScope({
				scopes: [controller.getDocScope()],
				snapshot,
				mutate: ([doc]) => {
					write(doc);
					return [{ op: 'noop' }];
				}
			});

		drainDevWarns();
		await controller.undoStep(snapshot, async () => {
			await commitOverDocument((doc) =>
				ensureUnsharedSubtree(ensureUnsharedChild(doc.body, 0, doc.sharing), doc.sharing)
			);
			await commitOverDocument((doc) => withStaleNestedQuote(doc.children[0]));
		});

		expect(firesStaleRaw(), 'expected an invariant:stale-raw fire').toBe(true);
	});
});
