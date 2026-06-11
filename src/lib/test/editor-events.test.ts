import { describe, it, expect, vi } from 'vitest';
import { createEditorEvents } from '$lib/editor/editor-events';

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
		const called: string[] = [];
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		events.on('edit', () => called.push('a'));
		events.on('edit', () => {
			called.push('b-throwing');
			throw new Error('subscriber blew up');
		});
		events.on('edit', () => called.push('c'));

		events.emit('edit', { op: 'delete', path: [0], timestamp: 0 });

		expect(called).toEqual(['a', 'b-throwing', 'c']);
		expect(consoleError).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
	});

	it('commitContainerStructural fires exactly one edit event per commit', async () => {
		const { createUndoController } = await import('$lib/editor/editor-actions/undo-controller');
		const { createUndoManager } = await import('$lib/editor/undo/manager');
		const { createSharingState } = await import('$lib/editor/undo/sharing');
		const { createSelectionState } = await import('$lib/editor/selection/selection-state.svelte');

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
			snapshot: { blockIndex: 0, offset: 0 },
			mutate: ({ children }) => {
				children.splice(1, 1);
				return { op: 'delete', at: 1, count: 1 };
			},
			op: { kind: 'delete', eventPath: [0, 1] }
		});

		expect(editCount).toBe(1);
	});
});
