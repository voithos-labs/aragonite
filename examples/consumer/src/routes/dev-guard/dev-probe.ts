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
	registerBlockKind,
	registerDirective,
	createDirectiveRebuild,
	setPluginMetadata,
	type CstNode,
	type EditorPlugin,
	type ParsedDirective
} from '@voithos-labs/aragonite/plugin';
import { svelteBlockView } from '@voithos-labs/aragonite/svelte';
import DevProbeBlock from './DevProbeBlock.svelte';

export const DEVPROBE = 'devprobe';

interface DevProbeMetadata {
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
		closerColonCount: parsed.closerColonCount,
		closerNewline: parsed.closerNewline
	});
	return node;
}

export function devProbePlugin(): EditorPlugin {
	return definePlugin({
		name: 'devprobe',
		setup() {
			activateDirectives();
			registerBlockKind(declarePluginKind(DEVPROBE), {
				view: svelteBlockView(DevProbeBlock),
				mergeRole: 'container',
				editable: true,
				gapEdges: 'none',
				supportsInline: false,
				container: {
					contract: 'opaque',
					rebuildRaw: createDirectiveRebuild()
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
					clipboard: { mode: 'not-supported', reason: 'dev-guard harness only' },
					simOracle: { mode: 'implemented', via: 'dev-guard e2e under the [invariant:] watcher' }
				}
			});

			registerDirective('container', DEVPROBE, {
				kind: declaredPluginKind(DEVPROBE),
				fromDirective: devprobeFromDirective
			});
		}
	});
}
