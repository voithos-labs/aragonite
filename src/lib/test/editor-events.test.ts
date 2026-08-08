import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEditorEvents, emitCommandError, type EditorError } from '$lib/editor-events';
import { asDocPath } from '$lib/selection/path-math';
import { recordPluginKindOwner, __resetInstalledPluginsForTests } from '$lib/schema/plugin-install';
import type { AnyBlockKind } from '$lib/core/nodes';

describe('createEditorEvents', () => {
	it('subscribes and fires edit events to registered handlers', () => {
		const events = createEditorEvents();
		const handler = vi.fn();
		events.on('edit', handler);
		events.emit('edit', {
			op: 'split',
			path: [2],
			detail: { at: 3 },
			timestamp: 0
		});
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({
			op: 'split',
			path: [2],
			detail: { at: 3 },
			timestamp: 0
		});
	});

	it('subscribe returns a disposer that unregisters the handler', () => {
		const events = createEditorEvents();
		const handler = vi.fn();
		const dispose = events.on('edit', handler);
		dispose();
		events.emit('edit', { op: 'delete', path: [0], timestamp: 0 });
		expect(handler).not.toHaveBeenCalled();
	});

	it('fires to multiple handlers in subscription order', () => {
		const events = createEditorEvents();
		const order: string[] = [];
		events.on('edit', () => order.push('a'));
		events.on('edit', () => order.push('b'));
		events.emit('edit', { op: 'delete', path: [0], timestamp: 0 });
		expect(order).toEqual(['a', 'b']);
	});

	it('dispatches selectionChange events independently of edit events', () => {
		const events = createEditorEvents();
		const editHandler = vi.fn();
		const selHandler = vi.fn();
		events.on('edit', editHandler);
		events.on('selectionChange', selHandler);
		events.emit('selectionChange', null);
		expect(selHandler).toHaveBeenCalledWith(null);
		expect(editHandler).not.toHaveBeenCalled();
	});

	it('handler that disposes itself mid-emit does not break iteration', () => {
		const events = createEditorEvents();
		const called: string[] = [];
		const disposeA = events.on('edit', () => {
			called.push('a');
			disposeA();
		});
		events.on('edit', () => called.push('b'));
		events.emit('edit', { op: 'delete', path: [0], timestamp: 0 });
		expect(called).toEqual(['a', 'b']);
	});

	it('a throwing subscriber does not starve downstream subscribers', () => {
		const events = createEditorEvents();
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const called: string[] = [];

		events.on('edit', () => called.push('a'));
		events.on('edit', () => {
			called.push('b-throwing');
			throw new Error('subscriber blew up');
		});
		events.on('edit', () => called.push('c'));

		events.emit('edit', { op: 'delete', path: [0], timestamp: 0 });

		expect(called).toEqual(['a', 'b-throwing', 'c']);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('commitContainerStructural fires exactly one edit event per commit', async () => {
		const { createUndoController } = await import('$lib/editor-actions/commit/undo-controller');
		const { createUndoManager } = await import('$lib/undo/manager');
		const { createSharingState } = await import('$lib/tree-operations/sharing');
		const { createSelectionState } = await import('$lib/selection/selection-state.svelte');

		const events = createEditorEvents();
		let editCount = 0;
		events.on('edit', (e) => {
			if (e.op !== 'input') editCount++;
		});

		const containerNode: any = {
			kind: 'list',
			leadingTrivia: '',
			raw: '- a\n- b\n',
			children: [
				{ kind: 'listItem', leadingTrivia: '', raw: '- a\n' },
				{ kind: 'listItem', leadingTrivia: '', raw: '- b\n' }
			]
		};
		const doc: any = { kind: 'document', prefix: '', children: [containerNode], suffix: '' };
		const blockIds = ['id0'];
		const blockRefs: any[] = [undefined];

		const deps: any = {
			get doc() {
				return doc;
			},
			get blockIds() {
				return blockIds;
			},
			get blockRefs() {
				return blockRefs;
			},
			setDoc: (v: any) => Object.assign(doc, v),
			setBlockIds: () => {},
			setBlockRefs: () => {},
			undoManager: createUndoManager(),
			sharing: createSharingState(),
			stickyColumn: {
				reset() {},
				capture() {},
				get current() {
					return null;
				}
			},
			edgeAffinity: {
				reset() {},
				note() {},
				noteTyping() {},
				get() {
					return null;
				}
			},
			selectionState: createSelectionState(),
			getBlockElByPath: () => null,
			operationsLog: undefined,
			events
		};

		const controller = createUndoController(deps);
		const state = {
			innerBlockIds: ['li0', 'li1'],
			innerBlockRefs: [undefined, undefined] as (any | undefined)[]
		};

		await controller.commitContainerStructural({
			containerNode,
			path: [0],
			state,
			snapshot: { path: asDocPath([0, 1]), offset: 0 },
			mutate: ({ children }) => {
				children.splice(1, 1);
				return { op: 'delete', at: 1, count: 1 };
			},
			op: { kind: 'delete', eventPath: asDocPath([0, 1]) }
		});

		expect(editCount).toBe(1);
	});
});

describe('editor-events — error channel', () => {
	it('routes a throwing edit-subscriber to the error channel as origin "subscriber"', () => {
		const events = createEditorEvents();
		const errors: { origin: string }[] = [];
		events.on('error', (e) => errors.push({ origin: e.origin }));
		events.on('edit', () => {
			throw new Error('subscriber boom');
		});
		events.emit('edit', {
			op: 'delete',
			path: [0],
			timestamp: 0
		} as Parameters<typeof events.emit<'edit'>>[1]);
		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('subscriber');
	});

	it('does not recurse when an error-subscriber itself throws (falls back to console.error)', () => {
		const events = createEditorEvents();
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		events.on('error', () => {
			throw new Error('error-handler boom');
		});
		expect(() => events.emit('error', { origin: 'render', error: new Error('x') })).not.toThrow();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('emitCommandError', () => {
	afterEach(() => __resetInstalledPluginsForTests());

	it("emits origin:'command' attributing the kind, command, and recorded plugin owner", () => {
		recordPluginKindOwner('demoNote', 'admonitions');
		const events = createEditorEvents();
		const captured: EditorError[] = [];
		events.on('error', (e) => captured.push(e));
		const boom = new Error('handler boom');

		emitCommandError(events, {
			kind: 'demoNote' as AnyBlockKind,
			command: 'note.setVariant',
			error: boom
		});

		expect(captured).toHaveLength(1);
		expect(captured[0].origin).toBe('command');
		expect(captured[0].error).toBe(boom);
		expect(captured[0].context).toEqual({
			kind: 'demoNote',
			command: 'note.setVariant',
			plugin: 'admonitions'
		});
	});

	it('omits the plugin when the kind has no recorded owner', () => {
		const events = createEditorEvents();
		const captured: EditorError[] = [];
		events.on('error', (e) => captured.push(e));

		emitCommandError(events, { kind: 'paragraph', command: 'x.y', error: new Error('e') });

		expect(captured[0].context).toEqual({ kind: 'paragraph', command: 'x.y', plugin: undefined });
	});

	// A global command reports its owner directly and carries no kind: the direct
	// `plugin` must win, never be clobbered by a (kind-less) owner lookup.
	it('attributes a global command by its direct plugin, with no kind', () => {
		const events = createEditorEvents();
		const captured: EditorError[] = [];
		events.on('error', (e) => captured.push(e));

		emitCommandError(events, { command: 'stats.count', plugin: 'docstats', error: new Error('e') });

		expect(captured[0].context).toEqual({
			kind: undefined,
			command: 'stats.count',
			plugin: 'docstats'
		});
	});

	it('no-ops without an events surface (a mount that never provided the context)', () => {
		expect(() =>
			emitCommandError(undefined, { kind: 'paragraph', command: 'x.y', error: new Error('e') })
		).not.toThrow();
	});
});
