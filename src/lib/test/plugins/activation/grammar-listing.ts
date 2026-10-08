import { activationFor } from '#lib/schema/plugin-activation.js';
import { createRegistryView } from '#lib/schema/registry-view.js';
import type { GrammarView } from '#lib/schema/block-openers.js';

/** The grammar of an editor whose `plugins` prop lists exactly `names`. */
export function grammarListing(names: string[]): GrammarView {
	return createRegistryView({ plugins: activationFor(names) }).grammar;
}
