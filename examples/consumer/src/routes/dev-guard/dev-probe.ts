/**
 * `:::devprobe` — a directive-backed container kind that exists only to trip one
 * DEV-mode guard through the packaged editor: its component passes an explicit
 * `isCollapsed` dep the descriptor never declares, so `createContainerBlock`
 * dev-warns at render. Idempotent (HMR / re-import); dev-guard harness only.
 */

import {
	declarePluginKind,
	declaredPluginKind,
	defineBlockComponent,
	registerBlockKind,
	registerBlockComponent,
	registerDirective,
	isBlockKindRegistered,
	isBlockComponentRegistered,
	isDirectiveRegistered,
	setPluginMetadata,
	getPluginMetadata,
	serializeDirective,
	serializeChildren,
	type CstNode,
	type ParsedDirective
} from 'aragonite/plugin';
import DevProbeBlock from './DevProbeBlock.svelte';

export const DEVPROBE = 'devprobe';

interface DevProbeMetadata {
	colonCount: number;
	info: string;
	closerColonCount: number;
	closerNewline: boolean;
}

function devprobeFromDirective(parsed: ParsedDirective): CstNode {
	const node: CstNode = {
		kind: declaredPluginKind(DEVPROBE),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: parsed.body?.children ?? [],
		innerSuffix: parsed.body?.suffix ?? ''
	};
	setPluginMetadata<DevProbeMetadata>(node, {
		colonCount: parsed.fence.colonCount,
		info: parsed.fence.info,
		closerColonCount: parsed.closerColonCount,
		closerNewline: parsed.closerNewline
	});
	return node;
}

function rebuildDevProbeRaw(node: CstNode): void {
	const meta = getPluginMetadata<DevProbeMetadata>(node);
	if (!meta) return;
	node.raw = serializeDirective({
		colonCount: meta.colonCount,
		name: DEVPROBE,
		info: meta.info,
		innerPrefix: node.innerPrefix ?? '',
		body: serializeChildren(node.children ?? []),
		innerSuffix: node.innerSuffix ?? '',
		closerColonCount: meta.closerColonCount,
		closerNewline: meta.closerNewline
	});
}

export function registerDevProbe(): void {
	if (!isBlockKindRegistered(DEVPROBE)) {
		registerBlockKind(declarePluginKind(DEVPROBE), {
			mergeRole: 'container',
			editable: true,
			supportsInline: false,
			container: {
				contract: 'opaque',
				rebuildRaw: rebuildDevProbeRaw,
				unwrapRole: {
					firstChildBackspace: 'lift-first-child',
					middleChildBackspace: 'default-merge'
				}
			}
		});
	}

	const devprobe = declaredPluginKind(DEVPROBE);

	if (!isDirectiveRegistered('container', DEVPROBE)) {
		registerDirective('container', DEVPROBE, {
			kind: devprobe,
			fromDirective: devprobeFromDirective
		});
	}

	if (!isBlockComponentRegistered(DEVPROBE)) {
		registerBlockComponent(devprobe, defineBlockComponent(DevProbeBlock));
	}
}
