// Miss-analysis: every container reached `createContainerActions` only through a mounted editor,
// where a dropped parent list context or a copied position surfaced only in e2e.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ListContext } from '$lib/action-contracts';
import type { NodeView } from '$lib/core/node-views';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY
} from '$lib/editor-keys';
import { createContainerActions } from '$lib/editor-actions/nested/container-actions';
import type { NestedActionsInput } from '$lib/editor-actions/nested/nested-actions';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

// Outside a component there is no context, so the test hands out its own.
const contexts = vi.hoisted(() => new Map<unknown, unknown>());
const built = vi.hoisted(() => ({
	calls: [] as { state: unknown; deps: unknown; overrides: unknown }[],
	provided: [] as unknown[]
}));

vi.mock('svelte', async (original) => ({
	...(await original<typeof import('svelte')>()),
	getContext: (key: unknown) => contexts.get(key)
}));
vi.mock('$lib/reactivity/block-list-state.svelte', () => ({
	createBlockListState: (getNode: () => NodeView) => ({ getNode })
}));
vi.mock('$lib/editor-actions/nested/nested-actions', () => ({
	createStandardNestedActions: (state: unknown, deps: unknown, overrides: unknown) => {
		built.calls.push({ state, deps, overrides });
		return { bundle: true };
	},
	setNestedActionsContexts: (bundle: unknown) => built.provided.push(bundle)
}));

const parentActions = {
	blockEdit: { id: 'edit' },
	focus: { id: 'focus' },
	containerEdit: { id: 'c' }
};
const stickyColumn = { id: 'sticky' };
const reading = fixtureReading();

beforeEach(() => {
	built.calls.length = 0;
	built.provided.length = 0;
	contexts.clear();
	contexts.set(BLOCK_EDIT_KEY, parentActions.blockEdit);
	contexts.set(FOCUS_KEY, parentActions.focus);
	contexts.set(CONTAINER_EDIT_KEY, parentActions.containerEdit);
	contexts.set(EDITOR_SERVICES_KEY, { stickyColumn });
	contexts.set(EDITOR_DOC_KEY, { reading });
});

function containerAt(position: { index: number; node: NodeView; path: number[] }) {
	const listContext = { id: 'outer list' } as unknown as ListContext;
	const overrides = vi.fn(() => () => ({}));
	const actions = createContainerActions({
		getNode: () => position.node,
		getIndex: () => position.index,
		getPath: () => position.path,
		parentListContext: listContext,
		overrides
	});
	const [call] = built.calls;
	return { actions, listContext, overrides, deps: call.deps as NestedActionsInput, call };
}

describe('createContainerActions passes its inputs through to the child actions', () => {
	it('hands the child actions the parent list context, the reading and the parent actions', () => {
		const node = { kind: 'list' } as unknown as NodeView;
		const { deps, listContext } = containerAt({ index: 0, node, path: [0] });
		expect(deps.parentListContext).toBe(listContext);
		expect(deps.reading).toBe(reading);
		expect(deps.stickyColumn).toBe(stickyColumn);
		expect(deps.parent).toEqual(parentActions);
	});

	it('reads the position at use, so an undo that moves the container moves its children', () => {
		const first = { kind: 'list' } as unknown as NodeView;
		const moved = { kind: 'list' } as unknown as NodeView;
		const position = { index: 0, node: first, path: [0] };
		const { deps, actions } = containerAt(position);
		Object.assign(position, { index: 3, node: moved, path: [3] });
		expect([deps.scope.index, deps.scope.node, deps.scope.path]).toEqual([3, moved, [3]]);
		expect((actions.state as unknown as { getNode: () => NodeView }).getNode()).toBe(moved);
	});

	it('builds the overrides from the scope and parent, and provides the bundle it built', () => {
		const node = { kind: 'list' } as unknown as NodeView;
		const { actions, overrides, call } = containerAt({ index: 0, node, path: [0] });
		expect(overrides).toHaveBeenCalledWith({ scope: actions.scope, parent: actions.parent });
		expect(call.overrides).toBe(overrides.mock.results[0].value);
		expect(built.provided).toEqual([actions.bundle]);
		expect(actions.reading).toBe(reading);
	});
});
