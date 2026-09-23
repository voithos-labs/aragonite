import { describe, it, expect, beforeEach } from 'vitest';
import { createEditorPluginContexts } from '$lib/schema/plugin-editor-context';
import {
	activationFor,
	everyInstalledPlugin,
	type PluginActivation
} from '$lib/schema/plugin-activation';
import { registerInsertEntry } from '$lib/schema/insert-catalogue';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { createEditorEvents, type EditorError } from '$lib/editor-events';
import { createDecorationEngine } from '$lib/decorations/decoration-state.svelte';
import type { DecorationRegistry } from '$lib/decorations/types';
import type { EditorRects } from '$lib/editor-rects';
import type { InlineMenuRegistry } from '$lib/inline-menu/types';
import type { InsertMarkdownOptions } from '$lib/editor-props';

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
const noopInlineMenus: InlineMenuRegistry = {
	addSource: () => ({ dispose() {} }),
	open: () => false,
	close() {},
	isOpen: false
};
const deps = (doc: { children: unknown[] }) => ({
	editorId: 'ed-1',
	getDoc: () => doc as never,
	events: fakeEvents,
	optionsFor: (name: string) => (name === 'opts' ? { max: 3 } : undefined),
	decorations: noopDecorations,
	rects: noopRects,
	inlineMenus: noopInlineMenus,
	getDocumentGeneration: () => 0,
	getPresentationMode: () => 'source' as const,
	getTheme: () => 'dark',
	activation: everyInstalledPlugin as PluginActivation,
	insertMarkdown: (() => false) as (md: string, options?: InsertMarkdownOptions) => boolean,
	runCommand: (() => false) as (commandId: string, arg?: unknown) => boolean
});

/** Two installed plugins, each recording the editors its hook attached to. */
function installPair(attached: string[]) {
	installPlugins([
		definePlugin({
			name: 'alpha',
			setup: (ctx) => ctx.onEditor(() => void attached.push('alpha'))
		}),
		definePlugin({
			name: 'beta',
			setup: (ctx) => ctx.onEditor(() => void attached.push('beta'))
		})
	]);
}

beforeEach(() => __resetSchemaRegistriesForTests());

describe('createEditorPluginContexts', () => {
	it('get() returns one stable identity per plugin, with per-plugin options', () => {
		const ctxs = createEditorPluginContexts(deps({ children: [] }));
		const a = ctxs.get('opts')!;
		expect(a).toBe(ctxs.get('opts'));
		expect(a.options).toEqual({ max: 3 });
		expect(ctxs.get('other')!.options).toBeUndefined();
		expect(a.editorId).toBe('ed-1');
	});

	it('document is a live getter, not a snapshot', () => {
		let doc = { children: [] as unknown[] };
		const ctxs = createEditorPluginContexts({ ...deps(doc), getDoc: () => doc as never });
		const ctx = ctxs.get('p')!;
		doc = { children: [1] };
		expect((ctx.document as never as { children: unknown[] }).children).toHaveLength(1);
	});

	it('documentGeneration is a live getter, not a snapshot', () => {
		let generation = 0;
		const ctxs = createEditorPluginContexts({
			...deps({ children: [] }),
			getDocumentGeneration: () => generation
		});
		const ctx = ctxs.get('p')!;
		expect(ctx.documentGeneration).toBe(0);
		generation = 2;
		expect(ctx.documentGeneration).toBe(2);
	});

	// Miss-analysis: the context carried no way to insert or run anything, so a plugin that wanted
	// a block had to be registered by the page; nothing asked the context to reach the instance.
	it('insertMarkdown and runCommand reach the instance, with its answer, false included', () => {
		const inserted: unknown[][] = [];
		const ran: unknown[][] = [];
		let answer = true;
		const ctx = createEditorPluginContexts({
			...deps({ children: [] }),
			insertMarkdown: (...args) => (inserted.push(args), answer),
			runCommand: (...args) => (ran.push(args), answer)
		}).get('p')!;

		expect(ctx.insertMarkdown('> ', { placement: 'below' })).toBe(true);
		expect(ctx.runCommand('heading.cycle', 2)).toBe(true);
		answer = false;
		expect(ctx.insertMarkdown('x')).toBe(false);
		expect(ctx.runCommand('nope')).toBe(false);
		expect(inserted).toEqual([
			['> ', { placement: 'below' }],
			['x', undefined]
		]);
		expect(ran).toEqual([
			['heading.cycle', 2],
			['nope', undefined]
		]);
	});

	it('insertCatalogue lists a plugin block only where this editor activated its plugin', () => {
		installPlugins([
			definePlugin({
				name: 'blocky',
				setup: () =>
					registerInsertEntry({
						id: 'blocky',
						label: 'Blocky',
						icon: 'plus',
						keywords: [],
						markdown: ':::blocky\n\n:::\n'
					})
			})
		]);
		const listed = (activation: PluginActivation) =>
			createEditorPluginContexts({ ...deps({ children: [] }), activation })
				.get('')!
				.insertCatalogue.map((e) => e.id);
		expect(listed(everyInstalledPlugin)).toContain('blocky');
		expect(listed(activationFor([]))).not.toContain('blocky');
	});

	it('presentationMode is a live getter, not a snapshot', () => {
		let mode: 'source' | 'reading' = 'source';
		const ctxs = createEditorPluginContexts({
			...deps({ children: [] }),
			getPresentationMode: () => mode
		});
		const ctx = ctxs.get('p')!;
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
		// toBe, not toEqual: "one context object" is a claim about identity, so a duplicate with
		// the same shape must fail this test.
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

	it('threads editor.decorations: addSource fills the state, the disposer runs, and a throwing source surfaces as origin decoration', () => {
		const doc = { children: [] as unknown[] };
		const events = createEditorEvents();
		const errorEvents: EditorError[] = [];
		events.on('error', (e) => errorEvents.push(e));
		// Mirrors Editor.svelte's wiring: onSourceError reports to the editor's events as an
		// origin: 'decoration' error naming the source at fault.
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

		// Identity, not shape: a copy per context would break the contract that there is one.
		expect(received).toBe(rects);
		expect(ctxs.get('measurer')!.rects).toBe(rects);
	});
});

describe('inline menus reach a plugin through its context', () => {
	it('threads editor.inlineMenus: the same registry instance reaches every context', () => {
		const inlineMenus: InlineMenuRegistry = { ...noopInlineMenus };
		let received: InlineMenuRegistry | undefined;
		installPlugins([
			definePlugin({
				name: 'suggester',
				setup(ctx) {
					ctx.onEditor((editor) => {
						received = editor.inlineMenus;
					});
				}
			})
		]);
		const ctxs = createEditorPluginContexts({ ...deps({ children: [] }), inlineMenus });
		ctxs.attachAll(() => {});

		expect(received).toBe(inlineMenus);
		expect(ctxs.get('suggester')!.inlineMenus).toBe(inlineMenus);
	});
});

describe('activation scopes an instance to the plugins it listed', () => {
	it('attachAll runs only the listed plugin hooks', () => {
		const attached: string[] = [];
		installPair(attached);
		const ctxs = createEditorPluginContexts({
			...deps({ children: [] }),
			activation: activationFor(['alpha'])
		});
		ctxs.attachAll(() => {});
		expect(attached).toEqual(['alpha']);
	});

	it('an instance that listed nothing runs every installed hook', () => {
		const attached: string[] = [];
		installPair(attached);
		const ctxs = createEditorPluginContexts(deps({ children: [] }));
		ctxs.attachAll(() => {});
		expect(attached).toEqual(['alpha', 'beta']);
	});

	it('get() resolves the listed plugin and nothing for the unlisted one', () => {
		installPair([]);
		const ctxs = createEditorPluginContexts({
			...deps({ children: [] }),
			activation: activationFor(['alpha'])
		});
		expect(ctxs.get('alpha')).toBeDefined();
		expect(ctxs.get('beta')).toBeUndefined();
		// The empty name is the editor's own base context, never a plugin, so it survives.
		expect(ctxs.get('')).toBeDefined();
	});
});
