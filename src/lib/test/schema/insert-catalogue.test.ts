import { beforeEach, describe, expect, it } from 'vitest';
import {
	insertCatalogue,
	registerInsertEntry,
	type InsertEntry
} from '$lib/schema/insert-catalogue';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

const everyone = () => true;
const ids = (isActive: (plugin: string) => boolean = everyone) =>
	insertCatalogue(isActive).map((e) => e.id);

const BUILT_IN_IDS = ['bullet', 'numbered', 'todo', 'quote', 'divider', 'code', 'table'];

const block = (id: string, over: Partial<InsertEntry> = {}): InsertEntry => ({
	id,
	label: id,
	icon: 'plus',
	keywords: [],
	markdown: `:::${id}\n\n:::\n`,
	...over
});

/** A plugin whose setup registers the given entries, so each is owned by that plugin. */
const pluginWith = (name: string, ...entries: InsertEntry[]) =>
	definePlugin({ name, setup: () => entries.forEach(registerInsertEntry) });

beforeEach(() => __resetSchemaRegistriesForTests());

describe('insertCatalogue', () => {
	it('lists the built-ins in menu order, then plugin entries in registration order', () => {
		installPlugins([pluginWith('first', block('one')), pluginWith('second', block('two'))]);
		expect(ids()).toEqual([...BUILT_IN_IDS, 'one', 'two']);
	});

	it('keeps the built-in bytes the flyout has always inserted', () => {
		const byId = new Map(insertCatalogue(everyone).map((e) => [e.id, e.markdown]));
		expect(byId.get('code')).toBe('```\n\n```\n');
		expect(byId.get('table')).toBe('| Column | Column |\n| --- | --- |\n|  |  |\n');
		expect(byId.get('divider')).toBe('---\n');
	});

	it('lists a plugin entry only where its plugin is installed and active', () => {
		installPlugins([pluginWith('shown', block('shown-block'))]);
		expect(ids()).toContain('shown-block');
		expect(ids((plugin) => plugin !== 'shown')).not.toContain('shown-block');

		__resetSchemaRegistriesForTests();
		expect(ids()).toEqual(BUILT_IN_IDS);
	});

	it('hides the entry of a plugin whose setup threw after registering it', () => {
		const broken = definePlugin({
			name: 'broken',
			setup: () => {
				registerInsertEntry(block('half'));
				throw new Error('boom');
			}
		});
		expect(() => installPlugins([broken])).toThrow(/boom/);
		expect(ids()).not.toContain('half');
	});

	it('hands out frozen entries, so a reader cannot rewrite what the flyout inserts', () => {
		const [first] = insertCatalogue(everyone);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.keywords)).toBe(true);
	});
});

describe('registerInsertEntry', () => {
	it('refuses an id already registered, and a built-in id', () => {
		registerInsertEntry(block('once'));
		expect(() => registerInsertEntry(block('once'))).toThrow(/already registered/);
		expect(() => registerInsertEntry(block('table'))).toThrow(/built-in/);
	});

	it('refuses an icon the menu cannot draw', () => {
		const unknownIcon = block('odd', { icon: 'no-such-glyph' as InsertEntry['icon'] });
		expect(() => registerInsertEntry(unknownIcon)).toThrow(/no-such-glyph/);
	});
});
