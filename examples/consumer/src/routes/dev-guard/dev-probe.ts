/**
 * `:::devprobe`: a container kind that exists only to trip one DEV-mode guard through the
 * packaged editor. Its component passes an `isCollapsed` dep the descriptor never declares,
 * so `createContainerBlock` dev-warns at render. Dev-guard harness only.
 */

import {
	activateDirectives,
	definePlugin,
	declarePluginKind,
	declaredPluginKind,
	defineBlockComponent,
	registerBlockKind,
	registerBlockComponent,
	registerDirective,
	isDirectiveRegistered,
	setPluginMetadata,
	getPluginMetadata,
	serializeDirective,
	serializeChildren,
	type CstNode,
	type EditorPlugin,
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

export function devProbePlugin(): EditorPlugin {
	return definePlugin({
		name: 'devprobe',
		setup() {
			activateDirectives();
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
				},
				conformanceFixture: ':::devprobe\n\nbody\n\n:::\n',
				closure: {
					roundTrip: { mode: 'implemented', via: 'container contract=opaque — rebuildDevProbeRaw' },
					focus: { mode: 'implemented', via: 'focus walks into the first body child' },
					mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
					selectionPaint: { mode: 'implemented', via: 'body child blocks paint; container cover' },
					searchPaint: {
						mode: 'implemented',
						via: 'children are real blocks — search descends and paints'
					},
					reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
					undo: { mode: 'inherit-default' },
					clipboard: { mode: 'inherit-default' },
					simOracle: { mode: 'implemented', via: 'dev-guard e2e under the [invariant:] watcher' }
				}
			});

			const devprobe = declaredPluginKind(DEVPROBE);
			// The directive registry survives a schema reset and re-registering a claimed name
			// throws, so this stays guarded even though the plugin unit owns once-per-process.
			if (!isDirectiveRegistered('container', DEVPROBE)) {
				registerDirective('container', DEVPROBE, {
					kind: devprobe,
					fromDirective: devprobeFromDirective
				});
			}

			registerBlockComponent(devprobe, defineBlockComponent(DevProbeBlock));
		}
	});
}
