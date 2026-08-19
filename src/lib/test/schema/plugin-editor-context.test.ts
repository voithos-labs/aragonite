import { describe, it, expect, beforeEach } from 'vitest';
import { createEditorPluginContexts } from '$lib/schema/plugin-editor-context';
import {
	definePlugin,
	installPlugins,
	__resetInstalledPluginsForTests
} from '$lib/schema/plugin-install';
import { createEditorEvents, type EditorError } from '$lib/editor-events';
import { createDecorationEngine } from '$lib/decorations/decoration-state.svelte';
import type { DecorationRegistry } from '$lib/decorations/types';
import type { EditorRects } from '$lib/editor-rects';

const fakeEvents = { on: () => () => {} } as never;
const noopDecorations: DecorationRegistry = {
	addSource: () => ({ invalidate() {}, dispose() {} })
};
const noopRects: EditorRects = {
	blockRect: () => null,
	rangeRects: () => [],
	caretRect: () => null,
	reveal: async () => false,
	scrollTo: async () => false,
	navigateTo: async () => false
};
const deps = (doc: { children: unknown[] }) => ({
	editorId: 'ed-1',
	getDoc: () => doc as never,
	events: fakeEvents,
	optionsFor: (name: string) => (name === 'opts' ? { max: 3 } : undefined),
	decorations: noopDecorations,
	rects: noopRects,
	getPresentationMode: () => 'source' as const,
	getTheme: () => 'dark'
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

	it('presentationMode is a live getter, not a snapshot', () => {
		let mode: 'source' | 'reading' = 'source';
		const ctxs = createEditorPluginContexts({
			...deps({ children: [] }),
			getPresentationMode: () => mode
		});
		const ctx = ctxs.get('p');
		expect(ctx.presentationMode).toBe('source');
		mode = 'reading';
		expect(ctx.presentationMode).toBe('reading');
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
		const ctxs = createEditorPluginContexts({ ...deps(doc), events, decorations: registry });
		ctxs.attachAll(() => {});

		expect(received).toBe(registry);
		expect(engine.marksForPath([0])).toHaveLength(1);
		expect(errorEvents).toHaveLength(1);
		expect(errorEvents[0].origin).toBe('decoration');
		expect(errorEvents[0].context?.source).toBe('bad');

		ctxs.dispose();
		expect(disposed).toBe(1);
	});

	it('threads editor.rects: the same registry instance reaches every context', () => {
		// A distinct instance from the deps default, so the assert below reads the passed one.
		const rects: EditorRects = { ...noopRects };
		let received: EditorRects | undefined;
		installPlugins([
			definePlugin({
				name: 'measurer',
				setup(ctx) {
					ctx.onEditor((editor) => {
						received = editor.rects;
					});
				}
			})
		]);
		const ctxs = createEditorPluginContexts({ ...deps({ children: [] }), rects });
		ctxs.attachAll(() => {});

		// Identity, not shape: a per-context copy would break the "one door" contract.
		expect(received).toBe(rects);
		expect(ctxs.get('measurer').rects).toBe(rects);
	});
});
