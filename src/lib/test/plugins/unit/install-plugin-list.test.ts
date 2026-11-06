// What an editor does with its own plugin list before anything mounts: which plugins run, with
// which options, and what gets reported instead of thrown.
import { describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import {
	installPluginList,
	type Contribution,
	type PluginError,
	type PluginList,
	type PluginSpec
} from '#lib/schema/plugin-unit.js';

function install(list: PluginList) {
	const errors: PluginError[] = [];
	const installed = installPluginList(list, (error) => errors.push(error));
	return { names: installed.map((p) => p.name), errors, installed };
}

const messages = (errors: PluginError[]) =>
	errors.map((e) => `${e.plugin} ${e.doing}: ${(e.cause as Error).message}`);

const unit = (name: string, extra: Partial<PluginSpec<object>> = {}) =>
	definePlugin({ name, version: '1.0.0', editor: '*', contributes: () => ({}), ...extra });

describe('one name, one plugin per list', () => {
	it('reads the same plugin value listed twice as one', () => {
		const a = unit('a');
		expect(install([a, a])).toMatchObject({ names: ['a'], errors: [] });
	});

	it('reports a second plugin under a taken name and keeps the first', () => {
		const first = unit('x');
		const { names, errors, installed } = install([first, unit('x')]);
		expect(names).toEqual(['x']);
		expect(messages(errors)).toEqual(["x install: plugin 'x' is listed twice; the first is kept"]);
		expect(installed).toHaveLength(1);
	});

	it('reports one plugin listed with two option sets', () => {
		const p = definePlugin({
			name: 'p',
			version: '1.0.0',
			editor: '*',
			defaults: { tag: '' },
			contributes: () => ({})
		});
		expect(messages(install([p({ tag: 'a' }), p({ tag: 'b' })]).errors)).toEqual([
			"p install: plugin 'p' is listed twice; the first is kept"
		]);
	});
});

describe('needs and conflicts', () => {
	// Miss-analysis: every needs row kept the needed plugin, so none left one out under a dependant.
	it.each([
		['a conflict', [unit('a', { conflicts: ['b'] })], unit('b')],
		[
			'a throwing contributes',
			[],
			unit('b', {
				contributes: () => {
					throw new Error('boom');
				}
			})
		]
	])('leaves out a plugin whose need %s left out, naming the need', (_, before, need) => {
		const { names, errors } = install([...before, unit('c', { needs: [need] })]);
		expect(names).not.toContain('c');
		expect(messages(errors).at(-1)).toBe(
			"c install: plugin 'c' needs 'b', which is left out, so it's left out too"
		);
	});

	it('adds a needed plugin ahead of the first plugin needing it, with its defaults', () => {
		const seen: unknown[] = [];
		const base = definePlugin({
			name: 'base',
			version: '1.0.0',
			editor: '*',
			defaults: { level: 1 },
			contributes: (options) => (seen.push(options), {})
		});
		expect(install([unit('top', { needs: [base] })]).names).toEqual(['base', 'top']);
		expect(seen).toEqual([{ level: 1 }]);
	});

	it('takes a listed plugin, options and all, over the one a need names', () => {
		const seen: unknown[] = [];
		const base = definePlugin({
			name: 'base',
			version: '1.0.0',
			editor: '*',
			defaults: { level: 1 },
			contributes: (options) => (seen.push(options), {})
		});
		expect(install([unit('top', { needs: [base] }), base({ level: 3 })]).names).toEqual([
			'base',
			'top'
		]);
		expect(seen).toEqual([{ level: 3 }]);
	});

	// Miss-analysis: the one conflict row listed the declaring plugin last, where both rules agree.
	const declares = unit('a', { conflicts: ['legacy'] });
	const legacy = unit('legacy');
	it.each([
		['declaring it first', [declares, legacy], 'a', 'legacy'],
		['declaring it second', [legacy, declares], 'legacy', 'a']
	])('keeps the plugin listed first in a conflict, %s', (_, list, first, later) => {
		const { names, errors } = install(list);
		expect(names).toEqual([first]);
		expect(messages(errors)).toEqual([
			`${later} install: plugin '${later}' can't run beside '${first}', listed before it, so it's left out`
		]);
	});

	it('weighs a conflict only against plugins still running', () => {
		const middle = unit('b', { conflicts: ['c'] });
		expect(install([unit('a', { conflicts: ['b'] }), middle, unit('c')]).names).toEqual(['a', 'c']);
	});
});

describe('options and contributes', () => {
	it('lays called options over the defaults, an undefined field keeping its default', () => {
		const seen: unknown[] = [];
		const p = definePlugin({
			name: 'p',
			version: '1.0.0',
			editor: '*',
			defaults: { a: 1, b: 2 },
			contributes: (options) => (seen.push(options), {})
		});
		install([p({ a: 5 })({ b: undefined })]);
		expect(seen).toEqual([{ a: 5, b: 2 }]);
	});

	it('reports a validate sentence and runs the plugin on its defaults', () => {
		const seen: unknown[] = [];
		const p = definePlugin({
			name: 'p',
			version: '1.0.0',
			editor: '*',
			defaults: { size: 1 },
			validate: (options) => (options.size > 0 ? undefined : 'size must be positive'),
			contributes: (options) => (seen.push(options), {})
		});
		const { names, errors } = install([p({ size: -1 })]);
		expect(names).toEqual(['p']);
		expect(messages(errors)).toEqual(['p validate: size must be positive']);
		expect(seen).toEqual([{ size: 1 }]);
	});

	// Miss-analysis: validate only ever returned a sentence, so a throw filed under contributes passed.
	it('reads a throwing validate as a validate sentence', () => {
		const seen: unknown[] = [];
		const p = definePlugin({
			name: 'p',
			version: '1.0.0',
			editor: '*',
			defaults: { size: 1 },
			validate: () => {
				throw new Error('cannot read size');
			},
			contributes: (options) => (seen.push(options), {})
		});
		const { names, errors } = install([p({ size: -1 })]);
		expect(names).toEqual(['p']);
		expect(messages(errors)).toEqual(['p validate: cannot read size']);
		expect(seen).toEqual([{ size: 1 }]);
	});

	it('reports a throwing contributes and leaves only that plugin out', () => {
		const contribution: Contribution = {};
		const throwing = unit('bad', {
			contributes: () => {
				throw new Error('boom');
			}
		});
		const { names, errors, installed } = install([
			throwing,
			unit('good', { contributes: () => contribution })
		]);
		expect(names).toEqual(['good']);
		expect(installed[0].contribution).toBe(contribution);
		expect(messages(errors)).toEqual(['bad contributes: boom']);
	});

	it('reports a plugin made for another editor version, in a dev build', () => {
		const { names, errors } = install([unit('old', { editor: '^0.1.0' })]);
		expect(names).toEqual(['old']);
		expect(messages(errors)).toEqual([
			expect.stringMatching(/^old install: plugin 'old' runs on editor \^0\.1\.0, not /)
		]);
	});

	it('calls contributes once per list, so two editors hold two sets of state', () => {
		let calls = 0;
		const p = unit('p', { contributes: () => (calls++, {}) });
		install([p]);
		install([p]);
		expect(calls).toBe(2);
	});
});
