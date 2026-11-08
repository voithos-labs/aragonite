/** `container`: a plugin block type whose content is other blocks. */
import type { BlockType } from '../../schema/plugin-unit';
import { madeBlockType } from '../../schema/block-type';
import { drawnView, type Drawing } from '../../schema/drawing';
import { checkLocalName, completerOf, priorityBefore } from '../../schema/block-shapes';
import {
	ambientMarker,
	containerRegistration,
	stripClaims,
	stripOpener,
	writtenLines,
	type ContainerSpec
} from '../../schema/container-block';

/** Makes a container block type; the editor reads and writes its lines from `lines`, so the plugin
 *  never writes its bytes. */
export function container<D = never>(spec: ContainerSpec<D>): BlockType<D> {
	checkLocalName('container', spec.name);
	const priority = priorityBefore(spec.before);
	const lines = writtenLines(spec.lines);
	const drawing: Drawing = {
		type: () => type,
		edit: 'container',
		singleLine: false,
		draw: (spec.draw as Drawing['draw'] | undefined) ?? ((_block, ctx) => ({ dom: children(ctx) })),
		...(lines.shape === 'indented' ? { ambientPrefix: (node) => ambientMarker(lines, node) } : {})
	};
	const type: BlockType<D> = madeBlockType<D>({
		local: spec.name,
		label: spec.label,
		priority,
		registration: containerRegistration(spec as ContainerSpec<unknown>, lines),
		view: drawnView(drawing),
		opener: (kind) => stripOpener(kind, spec.lines, priority, spec.interrupts ?? false),
		completer: completerOf(spec.complete, (written) => stripClaims(spec.lines, written))
	});
	return type;
}

const children = (ctx: object): HTMLElement => (ctx as { children: HTMLElement }).children;
