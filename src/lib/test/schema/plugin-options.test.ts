// Miss-analysis: every options test read back the entry it passed, so none asked what a plugin
// reads with no entry, with half an entry, or with one its own check rejects.
import { describe, it, expect, beforeEach } from 'vitest';
import { createEditorPluginContexts } from '$lib/schema/plugin-editor-context';
import type { Component } from 'svelte';
import { definePluginBlock } from '$lib/schema/define-plugin-block';
import { definePlugin, installPlugins, resolvePluginOptions } from '$lib/schema/plugin-install';
import type { BlockComponentExports } from '$lib/block-component';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { pluginContextDeps } from '../support/plugin-context-deps';

interface BadgeOptions {
	label: string;
	depth: number;
	tags: readonly string[];
}

const DEFAULTS: BadgeOptions = { label: 'default', depth: 6, tags: ['a', 'b'] };

// Keeps `label` when it is a string and `depth` when it is 1..6; anything else is left out.
function parseBadgeOptions(raw: unknown): Partial<BadgeOptions> {
	const { label, depth, tags } = (raw ?? {}) as Record<string, unknown>;
	const parsed: Partial<BadgeOptions> = {};
	if (typeof label === 'string') parsed.label = label;
	if (typeof depth === 'number' && depth >= 1 && depth <= 6) parsed.depth = depth;
	if (Array.isArray(tags)) parsed.tags = tags;
	return parsed;
}

function installBadge(parseOptions: (raw: unknown) => Partial<BadgeOptions> = parseBadgeOptions) {
	installPlugins([definePlugin({ name: 'badge', defaults: DEFAULTS, parseOptions, setup() {} })]);
}

const contextsWith = (raw: unknown) =>
	createEditorPluginContexts({
		...pluginContextDeps(),
		optionsFor: (name) => (name === 'badge' ? raw : undefined)
	});

beforeEach(() => __resetSchemaRegistriesForTests());

describe("a plugin's options in one editor", () => {
	it('are the defaults on a bare install', () => {
		installBadge();
		expect(contextsWith(undefined).get('badge')!.options).toEqual(DEFAULTS);
	});

	it('take an entry field by field, and an array replaces the default rather than joining it', () => {
		installBadge();
		expect(contextsWith({ depth: 2, tags: ['c'] }).get('badge')!.options).toEqual({
			label: 'default',
			depth: 2,
			tags: ['c']
		});
	});

	it('keep the default for a field parseOptions left out', () => {
		installBadge();
		expect(contextsWith({ label: 'mine', depth: 99 }).get('badge')!.options).toEqual({
			...DEFAULTS,
			label: 'mine'
		});
	});

	it('merge an unparsed entry the same way', () => {
		installPlugins([definePlugin({ name: 'badge', defaults: DEFAULTS, setup() {} })]);
		expect(contextsWith({ depth: 3, label: undefined }).get('badge')!.options).toEqual({
			...DEFAULTS,
			depth: 3
		});
	});

	it('are an empty object for a plugin that declares no defaults', () => {
		installPlugins([definePlugin({ name: 'badge', setup() {} })]);
		expect(contextsWith(undefined).get('badge')!.options).toEqual({});
	});

	it('fall back to the defaults when parseOptions throws, reported once the error handler attaches', () => {
		const boom = new Error('bad entry');
		installBadge(() => {
			throw boom;
		});
		const contexts = contextsWith({ depth: 2 });
		// A block reads its options while it renders, before the editor attaches its error handler.
		expect(contexts.get('badge')!.options).toEqual(DEFAULTS);

		const reports: { plugin: string; error: unknown }[] = [];
		contexts.attachAll((report) => reports.push(report));
		expect(reports).toHaveLength(1);
		expect(reports[0].plugin).toBe('badge');
		expect((reports[0].error as Error).cause).toBe(boom);
	});

	it('report a parseOptions throw at once when the error handler is already attached', () => {
		installBadge(() => {
			throw new Error('bad entry');
		});
		const contexts = contextsWith({ depth: 2 });
		const reports: string[] = [];
		contexts.attachAll((report) => reports.push(report.plugin));
		expect(reports).toEqual([]);
		expect(contexts.get('badge')!.options).toEqual(DEFAULTS);
		expect(contexts.get('badge')!.options).toEqual(DEFAULTS);
		expect(reports).toEqual(['badge']);
	});
});

describe('the one-block shortcut', () => {
	it('carries defaults and parseOptions onto the unit it returns', () => {
		const stubComponent = (() => {}) as unknown as Component<
			Record<string, unknown>,
			BlockComponentExports
		>;
		const unit = definePluginBlock({
			name: 'badge',
			kind: 'badge',
			component: stubComponent,
			register() {},
			defaults: DEFAULTS,
			parseOptions: parseBadgeOptions
		});
		expect(resolvePluginOptions(unit, { depth: 1, label: 7 })).toEqual({ ...DEFAULTS, depth: 1 });
	});
});
