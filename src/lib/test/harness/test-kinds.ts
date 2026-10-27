// Throwaway block kinds for suites that need one registered. Each declares a plugin kind and
// registers it in the shape the registry accepts, so a suite spells out only the fields it is
// about. Register into freshly reset registries: a registration happens once per process.

import type { PluginBlockKind } from '#lib/core/nodes.js';
import { registerChromeLeaf } from '#lib/plugin.js';
import {
	registerBlockKind,
	type BlockKindRegistration,
	type CaretBlockRegistration,
	type ContainerDescriptorGroup
} from '#lib/schema/block-kind-descriptor.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { testClosure } from '#lib/test/harness/closure.js';
import { testView } from '#lib/test/harness/test-view.js';
import type { BlockOpener } from '#lib/schema/block-openers.js';

/** Fields that override the leaf's defaults, or a function building them from the declared kind,
 *  for an opener whose nodes name it. */
export type TestKindFields =
	Partial<BlockKindRegistration> | ((kind: PluginBlockKind) => Partial<BlockKindRegistration>);

/** An editable, not-mergeable leaf with no inline content and no gap stops. */
export function testLeaf(name: string, over: TestKindFields = {}): PluginBlockKind {
	const kind = declarePluginKind(name);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		view: testView(),
		...(typeof over === 'function' ? over(kind) : over)
	});
	return kind;
}

// Distributes over the group's two shapes, so a title row still decides the unwrap role's type.
type ContractOptional<G> = G extends { contract: infer C }
	? Omit<G, 'contract'> & { contract?: C }
	: never;

/** A container kind, opaque unless `container` names another contract. */
export function testContainer(
	name: string,
	container: ContractOptional<ContainerDescriptorGroup>,
	over: ContainerFields | ((kind: PluginBlockKind) => ContainerFields) = {}
): PluginBlockKind {
	return testLeaf(name, (kind) => ({
		mergeRole: 'container',
		container: { contract: 'opaque', ...container },
		...(typeof over === 'function' ? over(kind) : over)
	}));
}

type ContainerFields = Partial<Extract<CaretBlockRegistration, { container: object }>> & {
	opener?: BlockOpener;
};

/** An opaque container whose child 0 is a title row, its title kind registered through the
 *  published `registerChromeLeaf` the way a plugin does, so production can build it. */
export function testChromeContainer(
	name: string,
	chromeName = `${name}-title`
): { container: PluginBlockKind; chrome: PluginBlockKind } {
	const chrome = declarePluginKind(chromeName);
	registerChromeLeaf(chrome);
	const container = testContainer(name, { rebuildRaw: () => {}, reservedChrome: { kind: chrome } });
	return { container, chrome };
}
