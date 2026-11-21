import { describe, it, expect, vi } from 'vitest';
import {
	createEditorEvents,
	emitCommandError,
	onPluginEvent,
	type EditorError,
	type EditorEventMap,
	type Events,
	type PluginEventReads
} from '#lib/editor-events.js';
import { modeOf } from '#lib/presentation-mode.js';
import { takeDevWarns } from './support/warn-gate';
import { configureEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import { asDocPath } from '#lib/core/coordinate-spaces.js';
import { makeNestedHarness } from './harness/editor-actions';
import type { AnyBlockKind } from '#lib/core/nodes.js';

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

		events.on('edit', () => called.push('a'));
		events.on('edit', () => {
			called.push('b-throwing');
			throw new Error('subscriber blew up');
		});
		events.on('edit', () => called.push('c'));

		events.emit('edit', { op: 'delete', path: [0], timestamp: 0 });

		expect(called).toEqual(['a', 'b-throwing', 'c']);
		// Through the dev-warning channel, not the console, so a test gate sees the error.
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['events']);
	});

	it('reports a swallowed subscriber throw to the console in a production build', () => {
		configureEditorEnv({ isDev: false });
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const events = createEditorEvents();
		const thrown = new Error('subscriber blew up');
		events.on('edit', () => {
			throw thrown;
		});

		events.emit('edit', { op: 'delete', path: [0], timestamp: 0 });

		// `devWarn` is silent in production, so without a console branch the consumer's exception
		// would vanish.
		expect(errSpy.mock.calls.map((args) => args[args.length - 1])).toEqual([thrown]);
		errSpy.mockRestore();
	});

	it('commitContainerStructural fires exactly one edit event per commit', async () => {
		const h = makeNestedHarness('- a\n- b\n');
		let editCount = 0;
		h.events.on('edit', (e) => {
			if (e.op !== 'input') editCount++;
		});

		await h.controller.commitContainerStructural({
			containerNode: h.getNode(),
			path: [0],
			state: h.state,
			snapshot: { path: asDocPath([0, 1]), offset: 0 },
			mutate: ({ node, children }) => {
				children.splice(1, 1);
				node.raw = '- a\n';
				return { op: 'delete', at: 1, count: 1 };
			},
			op: { kind: 'delete', eventPath: asDocPath([0, 1]) }
		});

		expect(editCount).toBe(1);
	});
});

describe('onPluginEvent', () => {
	const failure: EditorError = { origin: 'command', error: new Error('x') };
	const EMITTED: { [K in keyof EditorEventMap]: EditorEventMap[K] } = {
		edit: { op: 'split', path: [0], detail: { at: 1 }, timestamp: 0 },
		selectionChange: null,
		error: failure,
		presentationModeChange: 'live',
		themeChange: 'dark',
		menuChange: true,
		sourceSwap: { generation: 3 },
		searchChange: undefined
	};
	const reads = {
		edit: () => 'the edit',
		selection: () => null,
		doc: () => 'the doc',
		listenForEdits: () => () => {}
	} as unknown as PluginEventReads;
	const HEARS: { [K in keyof Events]: [keyof EditorEventMap, unknown] } = {
		edit: ['edit', 'the edit'],
		selection: ['selectionChange', { selection: null }],
		mode: ['presentationModeChange', modeOf('live')],
		theme: ['themeChange', 'dark'],
		menu: ['menuChange', true],
		load: ['sourceSwap', { doc: 'the doc', generation: 3 }],
		search: ['searchChange', undefined],
		error: ['error', failure]
	};

	// Miss-analysis: `edit`, `load`, `mode` and `selection` each had a mounted row; the other four
	// names had none, so one heard on another's channel event passed.
	it.each(Object.entries(HEARS))('%s hears its own channel event and no other', (name, hears) => {
		const [on, payload] = hears;
		const channel = createEditorEvents();
		const heard: [string, unknown][] = [];
		let sent = '';
		onPluginEvent(channel, reads, name as keyof Events, (got) => void heard.push([sent, got]));
		for (const event of Object.keys(EMITTED) as (keyof EditorEventMap)[]) {
			sent = event;
			channel.emit(event, EMITTED[event]);
		}
		expect(heard).toEqual([[on, payload]]);
	});

	// A listener still counted after it's gone keeps every later write's bytes for nobody.
	it('counts an edit listener in while it listens, and a listener of no other event', () => {
		let counted = 0;
		const counting = { ...reads, listenForEdits: () => (counted++, () => void counted--) };
		const channel = createEditorEvents();
		const offTheme = onPluginEvent(channel, counting, 'theme', () => {});
		expect(counted).toBe(0);
		const offEdit = onPluginEvent(channel, counting, 'edit', () => {});
		expect(counted).toBe(1);
		offTheme();
		offEdit();
		expect(counted).toBe(0);
	});
});

describe('editor-events: error channel', () => {
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

	it('does not recurse when an error-subscriber itself throws (reports instead)', () => {
		const events = createEditorEvents();
		events.on('error', () => {
			throw new Error('error-handler boom');
		});
		expect(() => events.emit('error', { origin: 'render', error: new Error('x') })).not.toThrow();
		const fires = takeDevWarns();
		expect(fires.map((w) => `${w.tag}: ${w.message}`)).toEqual(['events: error subscriber threw']);
	});
});

describe('emitCommandError', () => {
	// The dispatch names the plugin that registered the command; the report passes it through.
	it("emits origin:'command' attributing the kind, command, and reported plugin", () => {
		const events = createEditorEvents();
		const captured: EditorError[] = [];
		events.on('error', (e) => captured.push(e));
		const boom = new Error('handler boom');

		emitCommandError(events, {
			kind: 'demoNote' as AnyBlockKind,
			command: 'note.setVariant',
			plugin: 'admonitions',
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

	it('omits the plugin when no plugin registered the command', () => {
		const events = createEditorEvents();
		const captured: EditorError[] = [];
		events.on('error', (e) => captured.push(e));

		emitCommandError(events, { kind: 'paragraph', command: 'x.y', error: new Error('e') });

		expect(captured[0].context).toEqual({ kind: 'paragraph', command: 'x.y', plugin: undefined });
	});

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
