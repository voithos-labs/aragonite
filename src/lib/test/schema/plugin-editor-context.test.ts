import { describe, it, expect, beforeEach } from 'vitest';
import { createEditorPluginContexts } from '$lib/schema/plugin-editor-context';
import {
	definePlugin,
	installPlugins,
	__resetInstalledPluginsForTests
} from '$lib/schema/plugin-install';
import { createEditorEvents, type EditorError } from '$lib/editor-events';
import { createDecorationEngine } from '$lib/reactivity/decoration-state.svelte';
import type { DecorationRegistry } from '$lib/decorations/types';

const fakeEvents = { on: () => () => {} } as never;
const noopDecorations: DecorationRegistry = {
	addSource: () => ({ invalidate() {}, dispose() {} })
};
const deps = (doc: { children: unknown[] }) => ({
	editorId: 'ed-1',
	getDoc: () => doc as never,
	events: fakeEvents,
	optionsFor: (name: string) => (name === 'opts' ? { max: 3 } : undefined),
	decorations: noopDecorations
});

beforeEach(() => __resetInstalledPluginsForTests());

describe('createEditorPluginContexts', () => {
	it('get() returns one stable identity per plugin, with per-plugin options', () => {
		const ctxs = createEditorPluginContexts(deps({ children: [] }));
		const a = ctxs.get('opts');
		expect(a).toBe(ctxs.get('opts'));
		expect(a.options).toEqual({ max: 3 });
		expect(ctxs.get('other').options).toBeUndefined();
		expect(a.editorId).toBe('ed-1');
	});

	it('document is a live getter, not a snapshot', () => {
		let doc = { children: [] as unknown[] };
		const ctxs = createEditorPluginContexts({ ...deps(doc), getDoc: () => doc as never });
		const ctx = ctxs.get('p');
		doc = { children: [1] };
		expect((ctx.document as never as { children: unknown[] }).children).toHaveLength(1);
	});

	it('attachAll fires callbacks with the same object get() returns; dispose runs disposers', () => {
		const seen: unknown[] = [];
		let disposed = 0;
		installPlugins([
			definePlugin({
				name: 'watcher',
				setup(ctx) {
					ctx.onEditor((editor) => {
						seen.push(editor);
						return () => disposed++;
					});
				}
			})
		]);
		const ctxs = createEditorPluginContexts(deps({ children: [] }));
		ctxs.attachAll(() => {});
		// toBe, not toEqual: the "one context object" litmus is an IDENTITY claim —
		// a structurally-equal duplicate context must fail this test.
		expect(seen).toHaveLength(1);
		expect(seen[0]).toBe(ctxs.get('watcher'));
		ctxs.dispose();
		expect(disposed).toBe(1);
	});

	it('a throwing callback is contained and attributed; siblings still fire', () => {
		const errors: string[] = [];
		const fired: string[] = [];
		installPlugins([
			definePlugin({
				name: 'bad',
				setup(ctx) {
					ctx.onEditor(() => {
						throw new Error('boom');
					});
				}
			}),
			definePlugin({
				name: 'good',
				setup(ctx) {
					ctx.onEditor(() => {
						fired.push('good');
					});
				}
			})
		]);
		const ctxs = createEditorPluginContexts(deps({ children: [] }));
		ctxs.attachAll((r) => errors.push(r.plugin));
		expect(errors).toEqual(['bad']);
		expect(fired).toEqual(['good']);
	});

	it('threads editor.decorations: addSource fills the engine, the disposer runs, and a throwing source surfaces as origin decoration', () => {
		const doc = { children: [] as unknown[] };
		const events = createEditorEvents();
		const errorEvents: EditorError[] = [];
		events.on('error', (e) => errorEvents.push(e));
		// Mirror Editor.svelte's wiring: the engine's onSourceError routes to the events
		// surface as an origin: 'decoration' error naming the offending source.
		const engine = createDecorationEngine({
			getDoc: () => doc as never,
			onSourceError: (source, error) =>
				events.emit('error', { origin: 'decoration', error, context: { source } })
		});
		const registry: DecorationRegistry = { addSource: engine.addSource };

		let received: DecorationRegistry | undefined;
		let disposed = 0;
		installPlugins([
			definePlugin({
				name: 'deco',
				setup(ctx) {
					ctx.onEditor((editor) => {
						received = editor.decorations;
						editor.decorations.addSource({
							name: 'good',
							provide: () => [{ type: 'mark', path: [0], start: 0, end: 1, class: 'x' }]
						});
						editor.decorations.addSource({
							name: 'bad',
							provide: () => {
								throw new Error('boom');
							}
						});
						return () => disposed++;
					});
				}
			})
		]);
		const ctxs = createEditorPluginContexts({
			editorId: 'ed-1',
			getDoc: () => doc as never,
			events,
			optionsFor: () => undefined,
			decorations: registry
		});
		ctxs.attachAll(() => {});

		expect(received).toBe(registry);
		expect(engine.marksForPath([0])).toHaveLength(1);
		expect(errorEvents).toHaveLength(1);
		expect(errorEvents[0].origin).toBe('decoration');
		expect(errorEvents[0].context?.source).toBe('bad');

		ctxs.dispose();
		expect(disposed).toBe(1);
	});
});
