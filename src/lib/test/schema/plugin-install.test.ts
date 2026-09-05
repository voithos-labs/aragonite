import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	definePlugin,
	installPlugins,
	isPluginInstalled,
	owningPluginEditor,
	recordPluginKindOwner,
	type EditorContext
} from '$lib/schema/plugin-install';
import { declarePluginKind, declaredPluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { takeDevWarns } from '$lib/test/support/warn-gate';

/** The thrown error itself, where `toThrow` only proves that something threw. */
function captureThrow(run: () => void): unknown {
	try {
		run();
	} catch (err) {
		return err;
	}
	return undefined;
}

const minimalRegistration = {
	gapEdges: 'none',
	mergeRole: 'not-mergeable',
	editable: false,
	supportsInline: false,
	closure: testClosure
} as const;

beforeEach(() => __resetSchemaRegistriesForTests());

describe('installPlugins', () => {
	it('runs setup once and treats a re-install of the same object as a no-op', () => {
		let calls = 0;
		const plugin = definePlugin({
			name: 'once',
			setup: () => {
				calls++;
			}
		});

		installPlugins([plugin]);
		installPlugins([plugin]);

		expect(calls).toBe(1);
		expect(isPluginInstalled('once')).toBe(true);
	});

	it('ignores a second definition sharing an installed name; its setup never runs', () => {
		let firstCalls = 0;
		let secondCalls = 0;

		installPlugins([definePlugin({ name: 'dup', setup: () => firstCalls++ })]);
		installPlugins([definePlugin({ name: 'dup', setup: () => secondCalls++ })]);

		expect(firstCalls).toBe(1);
		expect(secondCalls).toBe(0);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['plugin-install']);
	});

	it('installs plugins in array order', () => {
		const log: string[] = [];

		installPlugins([
			definePlugin({ name: 'first', setup: () => log.push('first') }),
			definePlugin({ name: 'second', setup: () => log.push('second') })
		]);

		expect(log).toEqual(['first', 'second']);
	});

	it('wraps a failing setup and blocks re-install with a reload-advise error', () => {
		const original = new Error('kaboom');
		const plugin = definePlugin({
			name: 'broken',
			setup: () => {
				throw original;
			}
		});

		const thrown = captureThrow(() => installPlugins([plugin]));
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toMatch(/^plugin 'broken':/);
		expect((thrown as Error).message).toContain('kaboom');
		expect((thrown as Error).cause).toBe(original);
		expect(isPluginInstalled('broken')).toBe(false);

		// The reload advice names the dev-server restart too: a long-lived SSR/dev
		// process keeps the poisoned `failed` map across a page reload.
		expect(() => installPlugins([plugin])).toThrow(
			/failed during a previous install; reload the page \(or restart the dev server\)/
		);
	});

	it('names a versioned plugin as name@version in the failure diagnostics', () => {
		const plugin = definePlugin({
			name: 'broken-v',
			version: '1.2.0',
			setup: () => {
				throw new Error('kaboom');
			}
		});

		const firstThrow = captureThrow(() => installPlugins([plugin]));
		// The setup-wrap throw carries the version so a two-version collision is legible.
		expect((firstThrow as Error).message).toMatch(/^plugin 'broken-v@1\.2\.0':/);

		// The blocked-re-install throw carries it too.
		expect(() => installPlugins([plugin])).toThrow(
			/plugin 'broken-v@1\.2\.0' failed during a previous install/
		);
	});

	it('attributes a duplicate kind declaration to the plugin that first declared it', () => {
		const first = definePlugin({
			name: 'plugin-a',
			setup: () => {
				declarePluginKind('shared-kind');
			}
		});
		const second = definePlugin({
			name: 'plugin-b',
			setup: () => {
				declarePluginKind('shared-kind');
			}
		});

		installPlugins([first]);

		const thrown = captureThrow(() => installPlugins([second]));
		expect((thrown as Error).message).toContain("first declared by plugin 'plugin-a'");
	});

	it('attributes a duplicate block-kind registration to the declaring plugin', () => {
		const plugin = definePlugin({
			name: 'block-owner',
			setup: () => {
				const kind = declarePluginKind('owned-block');
				registerBlockKind(kind, minimalRegistration);
			}
		});
		installPlugins([plugin]);

		expect(() => registerBlockKind(declaredPluginKind('owned-block'), minimalRegistration)).toThrow(
			/first declared by plugin 'block-owner'/
		);
	});

	it('reset clears install state so a re-install re-runs setup and re-declares kinds', () => {
		let calls = 0;
		const plugin = definePlugin({
			name: 'resettable',
			setup: () => {
				calls++;
				declarePluginKind('resettable-kind');
			}
		});

		installPlugins([plugin]);
		expect(calls).toBe(1);
		expect(isPluginInstalled('resettable')).toBe(true);

		__resetSchemaRegistriesForTests();

		expect(isPluginInstalled('resettable')).toBe(false);
		installPlugins([plugin]);
		expect(calls).toBe(2);
	});
});

describe('owningPluginEditor', () => {
	it("resolves the owner's context; an unowned kind takes the base-context '' arm", () => {
		const lookup = vi.fn((name: string) => ({ editorId: name }) as unknown as EditorContext);
		recordPluginKindOwner('owned-kind', 'plug-a');

		expect(owningPluginEditor(lookup, 'owned-kind')?.editorId).toBe('plug-a');
		expect(owningPluginEditor(lookup, 'unowned-kind')?.editorId).toBe('');
		expect(owningPluginEditor(undefined, 'owned-kind')).toBeUndefined();
	});
});

describe('definePlugin validation', () => {
	it('rejects an empty name', () => {
		expect(() => definePlugin({ name: '', setup: () => {} })).toThrow(/invalid/);
	});

	it('rejects a name outside the plugin naming family', () => {
		expect(() => definePlugin({ name: 'BadName', setup: () => {} })).toThrow(/invalid/);
	});

	it('rejects a missing setup', () => {
		expect(() => definePlugin({ name: 'ok', setup: undefined as unknown as () => void })).toThrow(
			/setup/
		);
	});
});
