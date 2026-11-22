// @vitest-environment jsdom
// A plugin component compiled against another copy of Svelte fails as soon as the editor mounts it.
// Every route that mounts one says so in dev, instead of a generic failure that hides the cause.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Component } from 'svelte';
import { parse } from '#lib/core/parser.js';
import { createEditorEvents } from '#lib/editor-events.js';
import { svelteBlockView } from '#lib/components/svelte-block-view.js';
import { mountPluginView } from '#lib/plugin-view.js';
import { svelteView } from '#lib/svelte-view.svelte.js';
import { isForeignRuntimeError } from '#lib/foreign-runtime.js';
import { headless } from '#lib/testing.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import ThrowingBlock from './fixtures/ThrowingBlock.svelte';
import { mountBlockHost, type MountedHost } from './mount-host';

const CAUSE = 'compiled against a different Svelte runtime';

const FIXTURES = {
	'template only': () => import('./fixtures/ForeignTemplate.svelte'),
	'its own $effect': () => import('./fixtures/ForeignEffect.svelte')
};

/** A fresh copy of the fixture on a fresh copy of the Svelte runtime, never mounted before. */
async function loadForeign(name: keyof typeof FIXTURES): Promise<Component> {
	vi.resetModules();
	return (await FIXTURES[name]()).default;
}

beforeAll(headless);
beforeAll(installLayoutStubs);

let mounted: MountedHost | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
});

function mountBlock(component: Component<never>, raw = 'hello\n'): HTMLElement {
	const doc = parse(raw);
	const kind = testLeaf('foreign-runtime', { view: svelteBlockView(component as never) });
	doc.children[0].kind = kind;
	mounted = mountBlockHost(
		doc,
		{ node: doc.children[0] },
		{ services: { events: createEditorEvents() } }
	);
	return mounted.el;
}

/** A plugin view from a Svelte component, mounted the way every widget and row slot mounts one. */
function mountAsView(component: Component): boolean {
	const view = svelteView(component as never);
	const target = document.createElement('span');
	return (
		mountPluginView(view, target, {} as never, { report: () => {}, subject: 'probe' }) !== null
	);
}

const warnTags = () => takeDevWarns().map((record) => record.tag);

describe.each(Object.keys(FIXTURES) as (keyof typeof FIXTURES)[])(
	'a component on a second runtime (%s)',
	(name) => {
		it('fails its block with a notice naming the cause', async () => {
			const el = mountBlock(await loadForeign(name));
			const notice = el.querySelector('[data-failed-block] .failed-block-notice');
			expect(notice?.textContent).toContain(CAUSE);
			expect(warnTags()).toEqual(['foreign-runtime']);
		});

		it('as a widget or row view, fails its mount and warns with the cause', async () => {
			expect(mountAsView(await loadForeign(name))).toBe(false);
			expect(warnTags()).toEqual(['foreign-runtime']);
		});
	}
);

it('a template-only component fails a later mount differently, and that names the cause too', async () => {
	const component = await loadForeign('template only');
	expect(mountAsView(component)).toBe(false);
	takeDevWarns();
	const el = mountBlock(component);
	expect(el.querySelector('.failed-block-notice')?.textContent).toContain(CAUSE);
	expect(warnTags()).toEqual(['foreign-runtime']);
});

it('a block that throws for its own reasons keeps the plain notice', () => {
	const el = mountBlock(ThrowingBlock, 'boom\n');
	const notice = el.querySelector('[data-failed-block] .failed-block-notice');
	expect(notice?.textContent).toBe('⚠ block failed to render');
	expect(warnTags()).toEqual([]);
});

// Only V8 runs here, so the other engines' wording of both crashes is pinned by hand.
describe('isForeignRuntimeError', () => {
	it.each([
		['V8', "Cannot read properties of undefined (reading 'call')"],
		['SpiderMonkey', 'can\'t access property "call", first_child_getter is undefined'],
		['JavaScriptCore', "undefined is not an object (evaluating 'first_child_getter.call')"],
		['V8, a later mount', "Cannot read properties of null (reading 'nodes')"],
		['SpiderMonkey, a later mount', `can't access property "nodes", effect is null`],
		['JavaScriptCore, a later mount', "null is not an object (evaluating 'effect.nodes')"],
		['SpiderMonkey, a bundler-renamed variable', `can't access property "nodes", effect$1 is null`]
	])('reads the %s message', (_, message) => {
		expect(isForeignRuntimeError(new TypeError(message))).toBe(true);
	});

	it('reads a production build of the runtime naming effect_orphan only by its link', () => {
		expect(isForeignRuntimeError(new Error('https://svelte.dev/e/effect_orphan'))).toBe(true);
	});

	it.each([
		[
			'another undefined read',
			new TypeError("Cannot read properties of undefined (reading 'raw')")
		],
		[
			"a plugin's own read of nodes off undefined",
			new TypeError("Cannot read properties of undefined (reading 'nodes')")
		],
		[
			"a plugin's own call through an undefined handler, in SpiderMonkey",
			new TypeError(`can't access property "call", handler is undefined`)
		],
		[
			"a plugin's own read of nodes off null, in JavaScriptCore",
			new TypeError("null is not an object (evaluating 'graph.nodes')")
		],
		['a plain error mentioning call', new Error('could not call the renderer')],
		['a thrown string', 'effect_orphan']
	])('ignores %s', (_, error) => {
		expect(isForeignRuntimeError(error)).toBe(false);
	});
});
