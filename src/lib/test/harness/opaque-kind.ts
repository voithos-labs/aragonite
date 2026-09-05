/**
 * The throwaway opaque container the node-shape predicate suites register. Every one of them
 * declares the same leaf-descriptor shape and differs only in the container group, so the group is
 * the parameter and everything around it is here.
 */

import {
	registerBlockKind,
	type ContainerDescriptorGroup
} from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import type { PluginBlockKind } from '$lib/core/nodes';
import { testClosure } from '$lib/test/support/closure';

export function registerOpaque(
	name: string,
	container: Omit<ContainerDescriptorGroup, 'contract'>
): PluginBlockKind {
	const kind = declarePluginKind(name);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: { contract: 'opaque', ...container }
	});
	return kind;
}
