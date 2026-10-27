// A plugin registers only from a `definePlugin` setup: in dev, a call anywhere else throws with the
// fix, and only the editor's own entries are ever replaced by a dev server's re-evaluation (G1.104).
// Miss-analysis: every registration test ran under Vitest's test flag, so nothing exercised a
// module-scope call the way an app's dev server runs it.
import { describe, it, expect, beforeEach } from 'vitest';
import { configureEditorEnv } from '#lib/testing.js';
import { definePlugin, installPlugins, registerAsCore } from '#lib/schema/plugin-install.js';
import { createPluginRegistry } from '#lib/schema/plugin-registry.js';
import { registerPasteTransform } from '#lib/tree-operations/paste/paste-transforms.js';
import { declarePluginKind, declaredPluginKind } from '#lib/schema/plugin-kind.js';
import {
	augmentBlockKind,
	getBlockKindDescriptor,
	registerBlockKind
} from '#lib/schema/block-kind-descriptor.js';
import { activateDirectives } from '#lib/plugin.js';
import { DIRECTIVE_CONTAINER } from '#lib/core/directive/kinds.js';
import { testClosure } from '#lib/test/harness/closure.js';
import { testView } from '#lib/test/harness/test-view.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const asDevServer = () => configureEditorEnv({ isDev: true, isTest: false });
const transform = (name: string) => ({ name, transform: () => null });

describe('a registration outside a plugin setup', () => {
	beforeEach(asDevServer);

	it('throws in dev, naming definePlugin and the test-runner switch', () => {
		expect(() => registerPasteTransform(transform('bare'))).toThrow(
			/registerPasteTransform: called outside a plugin's setup.*definePlugin.*configureEditorEnv\(\{ isTest: true \}\)/
		);
		expect(() => declarePluginKind('bare-kind')).toThrow(/declarePluginKind: called outside/);
	});

	it('passes once a runner other than Vitest says it is a test', () => {
		configureEditorEnv({ isTest: true });
		expect(() => registerPasteTransform(transform('runner'))).not.toThrow();
	});

	it('passes inside a setup, and inside the editor’s own bootstraps', () => {
		installPlugins([
			definePlugin({ name: 'in-setup', setup: () => registerPasteTransform(transform('ok')) })
		]);
		expect(() => registerAsCore(() => registerPasteTransform(transform('core')))).not.toThrow();
	});
});

describe('a duplicate on a dev server', () => {
	beforeEach(asDevServer);

	it('replaces an editor-owned entry, with a note', () => {
		const registry = createPluginRegistry<string, number>({
			label: 'probe',
			isBuiltin: () => false
		});
		registry.registerCore('core-key', 1);
		expect(() => registry.registerCore('core-key', 2)).not.toThrow();
		expect(registry.getIgnoringActivation('core-key')).toBe(2);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['registry']);
	});

	it('throws for a plugin entry, as production does', () => {
		expect(() =>
			installPlugins([
				definePlugin({
					name: 'twice',
					setup() {
						registerPasteTransform(transform('dup'));
						registerPasteTransform(transform('dup'));
					}
				})
			])
		).toThrow(/already registered/);
	});

	// Hot reload re-evaluates a plugin's module into a new unit with the same name; the install
	// keeps the first and never re-runs a setup, so no plugin entry meets a duplicate.
	it('never reaches a plugin entry: a re-evaluated plugin module keeps the first registration', async () => {
		const first = await import('#lib/plugins/parrot/parrot-plugin.js');
		installPlugins([first.parrotPlugin()]);
		const registered = getBlockKindDescriptor(declaredPluginKind('parrot'));
		// A query makes a second instance of the module, sharing every registry with the first.
		const reevaluatedPath = '../../plugins/parrot/parrot-plugin.ts?reeval';
		const reevaluated: typeof first = await import(/* @vite-ignore */ reevaluatedPath);
		expect(reevaluated.parrotPlugin).not.toBe(first.parrotPlugin);
		installPlugins([reevaluated.parrotPlugin()]);

		expect(getBlockKindDescriptor(declaredPluginKind('parrot'))).toBe(registered);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['plugin-install']);
	});
});

// Miss: every duplicate row used a plugin key, so a plugin re-registering a built-in key, which the
// dev replacement and the guard both waved through by key, never ran.
describe('a plugin registering a built-in key on a dev server', () => {
	beforeEach(asDevServer);

	const paragraphRival = () =>
		registerBlockKind('paragraph', {
			gapEdges: 'none',
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			view: testView()
		});

	it('throws inside a setup, and leaves the built-in in place', () => {
		const before = getBlockKindDescriptor('paragraph');
		expect(() => installPlugins([definePlugin({ name: 'rival', setup: paragraphRival })])).toThrow(
			/already registered/
		);
		expect(getBlockKindDescriptor('paragraph')).toBe(before);
	});

	it('throws outside a setup, and leaves the built-in in place', () => {
		const before = getBlockKindDescriptor('paragraph');
		expect(paragraphRival).toThrow(/outside a plugin's setup/);
		expect(getBlockKindDescriptor('paragraph')).toBe(before);
	});
});

// Miss: the setup check sat on the first registration only, and an augment writes in place.
describe('an augment outside a plugin setup on a dev server', () => {
	beforeEach(asDevServer);

	it('throws for a kind no plugin owns, which the owner check lets through', () => {
		activateDirectives();
		const directive = declaredPluginKind(DIRECTIVE_CONTAINER);
		const before = getBlockKindDescriptor(directive);
		expect(() => augmentBlockKind(directive, { label: 'Rewritten' })).toThrow(
			/augmentBlockKind: called outside a plugin's setup/
		);
		expect(getBlockKindDescriptor(directive)).toBe(before);
	});
});
