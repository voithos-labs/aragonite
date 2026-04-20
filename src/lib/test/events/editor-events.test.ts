import { describe, it, expect, vi } from 'vitest';
import { createEditorEvents } from '$lib/editor/events/editor-events';

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

	// Enabled in Task 10 (0.5.4 plan) when commitContainerStructural exists.
	// Test #5 from the failing-first pin list: a container edit must fire
	// exactly one edit event per commit (no duplicate events, no misses).
	it.skip('commitContainerStructural fires exactly one edit event per commit', () => {
		// Implementation lands with commitContainerStructural in Task 10.
	});
});
