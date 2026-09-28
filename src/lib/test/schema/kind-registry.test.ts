// Miss-analysis: a kind registry's owner was an option each registry passed by hand, and the two
// inline registries left it out, so no test ran the owner rule through one shared constructor.
import {
	createBlockKindRegistry,
	createInlineKindRegistry,
	createPluginRegistry
} from '$lib/schema/plugin-registry';
import { afterEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { activationFor } from '$lib/schema/plugin-activation';
import { declarePluginInlineKind, declarePluginKind } from '$lib/schema/plugin-kind';
import type { AnyBlockKind, AnyInlineKind } from '$lib/core/nodes';

// ── Compile-time pins ───────────────────────────────────────────────────────
// Never called: `npm run check` is the gate. An "unused '@ts-expect-error'" error means a kind's
// entries can be built into a registry that answers to the registering plugin again.
const typePins = (): void => {
	// @ts-expect-error a block-kind key needs createBlockKindRegistry
	createPluginRegistry<AnyBlockKind, true>({ label: 'pin', isBuiltin: () => false });
	// @ts-expect-error an inline-kind key needs createInlineKindRegistry
	createPluginRegistry<AnyInlineKind, true>({ label: 'pin', isBuiltin: () => false });
	// @ts-expect-error no registry takes its owner as an option
	createPluginRegistry<string, true>({ label: 'pin', isBuiltin: () => false, ownerOf: () => null });
};
void typePins;

const blockRegistry = createBlockKindRegistry<string>({ label: 'probe', isBuiltin: () => false });
const inlineRegistry = createInlineKindRegistry<string>({ label: 'probe', isBuiltin: () => false });

const NAME = 'shared-name';

afterEach(resetPluginPlatformForTests);

describe('a kind registry answers to the plugin that declared the kind', () => {
	it.each([
		['block', () => blockRegistry, () => declarePluginKind(NAME)],
		['inline', () => inlineRegistry, () => declarePluginInlineKind(NAME)]
	] as const)(
		'%s: an entry another plugin registered resolves where the declarer is listed',
		(_tier, registry, declare) => {
			let kind = '' as AnyBlockKind & AnyInlineKind;
			installPlugins([
				definePlugin({
					name: 'declarer',
					setup() {
						kind = declare() as typeof kind;
					}
				}),
				definePlugin({
					name: 'registrant',
					setup() {
						registry().register(kind, 'entry');
					}
				})
			]);
			expect(registry().ownerOf(kind)).toBe('declarer');
			expect(registry().get(kind, activationFor(['declarer']))).toBe('entry');
			expect(registry().get(kind, activationFor(['registrant']))).toBeUndefined();
		}
	);

	it('reads the block declarer for a block kind and the inline one for an inline kind', () => {
		installPlugins([
			definePlugin({ name: 'blocks', setup: () => void declarePluginKind(NAME) }),
			definePlugin({ name: 'inlines', setup: () => void declarePluginInlineKind(NAME) })
		]);
		blockRegistry.register(NAME as AnyBlockKind, 'block');
		inlineRegistry.register(NAME as AnyInlineKind, 'inline');
		expect(blockRegistry.ownerOf(NAME as AnyBlockKind)).toBe('blocks');
		expect(inlineRegistry.ownerOf(NAME as AnyInlineKind)).toBe('inlines');
	});
});
