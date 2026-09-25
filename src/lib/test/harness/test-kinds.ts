// Throwaway block kinds for suites that need one registered. Each declares a plugin kind and
// registers it in the shape the registry accepts, so a suite spells out only the fields it is
// about. Register into freshly reset registries: a registration happens once per process.

import type { PluginBlockKind } from '$lib/core/nodes';
import { registerChromeLeaf } from '$lib/plugin';
import {
	registerBlockKind,
	type BlockKindRegistration,
	type ContainerDescriptorGroup
} from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { testClosure } from '$lib/test/support/closure';

/** An editable, not-mergeable leaf with no inline content and no gap stops. */
export function testLeaf(name: string, over: Partial<BlockKindRegistration> = {}): PluginBlockKind {
	const kind = declarePluginKind(name);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		...over
	});
	return kind;
}

/** A container kind, opaque unless `container` names another contract. */
export function testContainer(
	name: string,
	container: Omit<ContainerDescriptorGroup, 'contract'> &
		Partial<Pick<ContainerDescriptorGroup, 'contract'>>,
	over: Partial<BlockKindRegistration> = {}
): PluginBlockKind {
	return testLeaf(name, {
		mergeRole: 'container',
		container: { contract: 'opaque', ...container },
		...over
	});
}

/** An opaque container whose child 0 is a title row, registered the way a plugin registers one:
 *  the title kind through the published `registerChromeLeaf`, with its component and paste
 *  surface, so the container is one production can build. */
export function testChromeContainer(
	name: string,
	chromeName = `${name}-title`
): { container: PluginBlockKind; chrome: PluginBlockKind } {
	const chrome = declarePluginKind(chromeName);
	registerChromeLeaf(chrome);
	const container = testContainer(name, { rebuildRaw: () => {}, reservedChrome: { kind: chrome } });
	return { container, chrome };
}
