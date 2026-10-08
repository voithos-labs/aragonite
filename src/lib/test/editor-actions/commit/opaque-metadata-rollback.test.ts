// Miss-analysis: the multi-scope rollback tests wrote bytes a rebuild reads no metadata from, so
// none checked that a rollback puts back metadata re-read from the bytes.
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { parse } from '#lib/core/parser.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createBlockListState } from '#lib/reactivity/block-list-state.svelte.js';
import { asDocPath } from '#lib/selection/path-math.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import type { AnyBlockKind, CstNode } from '#lib/core/nodes.js';
import { testContainer } from '#lib/test/harness/test-kinds.js';

let THROWING: AnyBlockKind;

beforeEach(() => {
	installPlugins([admonitionsPlugin()]);
	THROWING = testContainer('spec-throwing-rebuild-opaque-meta', {
		rebuildRaw: () => {
			throw new Error('rebuildRaw exploded');
		}
	});
});

/** doc → [directive → paragraph, throwing container]. */
function makeDoc() {
	const harness = makeEditorActionsDeps([
		parse(':::spoiler\nhidden\n:::\n').children[0],
		{ kind: THROWING, leadingTrivia: '\n', raw: 'boom\n', children: [] } as CstNode
	]);
	const controller = createUndoController(harness.deps);
	const directive = () => harness.deps.doc.children[0];
	const thrower = () => harness.deps.doc.children[1];
	return { ...harness, controller, directive, thrower };
}

/** Copies the directive inside a held-open undo entry, so the throwing commit writes the live
 *  copy and only the rollback's saved values can put it back. */
async function seedUndoUnit(h: ReturnType<typeof makeDoc>): Promise<void> {
	void h.controller.undoStep({ path: asDocPath([0, 0]), offset: 0 }, () => new Promise(() => {}));
	await h.controller.commitMultiScope({
		scopes: [{ node: h.directive(), path: [0], state: createBlockListState(h.directive) }],
		snapshot: { path: asDocPath([0, 0]), offset: 0 },
		mutate: ([scope]) => {
			scope.children[0].raw = 'hidden\n';
			return [{ op: 'noop' }];
		}
	});
}

describe('a commit that unwinds after a fence was lengthened (#640)', () => {
	it('puts back the metadata the rebuild re-read, with the bytes', async () => {
		const h = makeDoc();
		await seedUndoUnit(h);
		const directive = h.directive();

		// The body line reads as the closer, so the directive's rebuild lengthens its fence before
		// the second scope's rebuild throws.
		await expect(
			h.controller.commitMultiScope({
				scopes: [
					{ node: directive, path: [0], state: createBlockListState(h.directive) },
					{ node: h.thrower(), path: [1], state: createBlockListState(h.thrower) }
				],
				snapshot: { path: asDocPath([0, 0]), offset: 0 },
				mutate: ([scope]) => {
					scope.children[0].raw = 'hidden\n:::\n';
					return [{ op: 'noop' }, { op: 'noop' }];
				}
			})
		).rejects.toThrow('rebuildRaw exploded');

		expect(h.directive()).toBe(directive);
		expect(directive.raw).toBe(':::spoiler\nhidden\n:::\n');
		expect(directive.metadata).toEqual(parse(directive.raw).children[0].metadata);
	});
});
