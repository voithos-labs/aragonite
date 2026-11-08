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
	COLON_LINES,
	setPluginMetadata,
	type CstNode,
	type EditorPlugin,
	type ParsedDirective
} from '@voithos-labs/aragonite/plugin';
import { svelteBlockView } from '@voithos-labs/aragonite/svelte';
import DevProbeBlock from './DevProbeBlock.svelte';

export const DEVPROBE = 'devprobe';

function devprobeFromDirective(parsed: ParsedDirective): CstNode {
	const node: CstNode = {
		kind: declaredPluginKind(DEVPROBE),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: parsed.body?.children ?? [],
		innerSuffix: parsed.body?.suffix ?? ''
	};
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
				container: { lines: COLON_LINES },
				conformanceFixture: ':::devprobe\n\nbody\n\n:::\n'
			});

			registerDirective('container', DEVPROBE, {
				kind: declaredPluginKind(DEVPROBE),
				fromDirective: devprobeFromDirective
			});
		}
	});
}
