// @vitest-environment jsdom
// Miss-analysis: the registry tests only ever registered, so no test unmounted a container and
// looked its node up again; a windowed-out list kept answering with its dead component's state.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { createBlockListState } from '#lib/block-lists/block-list-state.svelte.js';
import {
	getStateForNode,
	isUnmountedBlockListState,
	registerBlockListState
} from '#lib/block-lists/state-registry.js';
import type { BlockListState } from '#lib/block-lists/block-list-state.svelte.js';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { asDocPath } from '#lib/core/coordinate-spaces.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { drainDevWarns, takeDevWarns } from '#lib/test/support/warn-gate.js';
import KeyedListState from './fixtures/KeyedListState.svelte';

function listNode(): CstNode {
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: { ordered: false },
		innerPrefix: '',
		children: [],
		innerSuffix: ''
	} as CstNode;
}

/** A state owned by its own effect root, as a mounted component owns one; returns its unmount. */
function mountState(node: CstNode): { state: BlockListState; unmount: () => void } {
	let state!: BlockListState;
	const dispose = $effect.root(() => {
		state = createBlockListState(() => node);
	});
	flushSync();
	return { state, unmount: dispose };
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe('a container state lives in the registry while its container is mounted', () => {
	it('leaves the registry when its container unmounts', () => {
		const node = listNode();
		const mounted = mountState(node);
		expect(getStateForNode(node)).toBe(mounted.state);

		mounted.unmount();
		expect(getStateForNode(node)).toBeUndefined();
		expect(isUnmountedBlockListState(mounted.state)).toBe(true);
	});

	// A remount's incoming registration and outgoing teardown can run in either order.
	it.each([
		['the old teardown runs first', true],
		['the new mount registers first', false]
	])('a remount in place resolves to the new mount when %s', (_, oldFirst) => {
		const node = listNode();
		const old = mountState(node);
		if (oldFirst) old.unmount();
		const fresh = mountState(node);
		cleanups.push(fresh.unmount);
		if (!oldFirst) old.unmount();
		expect(getStateForNode(node)).toBe(fresh.state);
	});

	it('resolves to the new mount when the outgoing one claims the node again before it goes', () => {
		const node = listNode();
		const old = mountState(node);
		const fresh = mountState(node);
		cleanups.push(fresh.unmount);
		// The outgoing component's re-register effect runs after the new mount registered.
		registerBlockListState(node, old.state);
		expect(getStateForNode(node)).toBe(old.state);
		old.unmount();
		expect(getStateForNode(node)).toBe(fresh.state);
	});

	it('a {#key} remount leaves the registry on the live mount', () => {
		const node = listNode();
		let generation = $state(0);
		const target = document.createElement('div');
		const props = {
			node,
			get generation() {
				return generation;
			}
		};
		const instance = mount(KeyedListState, { target, props });
		flushSync();
		const first = getStateForNode(node);
		expect(first).toBeDefined();

		generation++;
		flushSync();
		const second = getStateForNode(node);
		expect(second).toBeDefined();
		expect(second).not.toBe(first);
		expect(isUnmountedBlockListState(second!)).toBe(false);

		void unmount(instance);
		flushSync();
		expect(getStateForNode(node)).toBeUndefined();
	});
});

describe('the commit refuses a container state whose component has unmounted (G1.138)', () => {
	it('fires block-list-state-mounted for a state held across its container unmounting', async () => {
		const { deps } = makeEditorActionsDeps(parse('- one\n- two\n').children);
		const controller = createUndoController(deps);
		const list = () => deps.doc.children[0];
		const held = mountState(list());
		held.unmount();

		drainDevWarns();
		await controller.commitMultiScope({
			scopes: [{ node: list(), state: held.state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: () => [{ op: 'noop' }]
		});

		const tags = takeDevWarns().map((fire) => fire.tag);
		expect(tags).toContain('invariant:block-list-state-mounted');
	});
});
