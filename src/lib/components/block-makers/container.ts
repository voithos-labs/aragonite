/** `container`: a plugin block type whose content is other blocks. */
import type { BlockType } from '../../schema/plugin-unit';
import { madeBlockType } from '../../schema/block-type';
import type { Drawing } from '../../schema/drawing';
import { drawnView } from '../drawn-block/drawn-view';
import { checkLocalName, completerOf, priorityBefore } from '../../schema/block-shapes';
import {
	ambientMarker,
	containerRegistration,
	type ContainerSpec
} from '../../schema/container-block';
import { stripClaims, stripOpener, type ContainerLines } from '../../core/parsers/strip-container';
import { headedLines } from '../../schema/headed-lines';
import type { IndentedLines, MarkedLines } from '../../core/strip-lines';
import type { CstNode } from '../../core/nodes';
import { writeContainerRaw } from '../../schema/container-writer';
import { cloneNode } from '../../tree-operations/clone';

/** Makes a container block type; the editor reads and writes its lines from `lines`, so the plugin
 *  never writes its bytes. */
export function container<D extends object = never>(spec: ContainerSpec<D>): BlockType<D> {
	checkLocalName('container', spec.name);
	const priority = priorityBefore(spec.before);
	const lines = writtenLines(spec.lines);
	const drawing: Drawing = {
		type: () => type,
		edit: 'container',
		singleLine: false,
		draw: (spec.draw as Drawing['draw'] | undefined) ?? ((_block, ctx) => ({ dom: children(ctx) })),
		// The editor's own drawing reads no answers, so a spec with no `draw` starts no watch.
		depends: spec.draw && spec.depends,
		...(lines.shape === 'indented' ? { ambientPrefix: (node) => ambientMarker(lines, node) } : {})
	};
	const type: BlockType<D> = madeBlockType<D>({
		local: spec.name,
		label: spec.label,
		icon: spec.icon,
		insert: spec.insert,
		chords: spec.chords,
		actions: spec.actions,
		commands: spec.commands,
		priority,
		registration: containerRegistration(spec as ContainerSpec<object>, lines),
		view: drawnView(drawing),
		openers: (kind) => [stripOpener(kind, spec.lines, priority, spec.interrupts ?? false)],
		completer: completerOf(spec.complete, (written) => stripClaims(spec.lines, written)),
		writeData(node, data, grammar) {
			const copy = cloneNode(node);
			copy.metadata = data as CstNode['metadata'];
			writeContainerRaw(copy, grammar);
			return copy.raw;
		}
	});
	return type;
}

const children = (ctx: object): HTMLElement => (ctx as { children: HTMLElement }).children;

// A head line brings its own writer.
function writtenLines<D extends object>(lines: ContainerLines<D>): MarkedLines | IndentedLines<D> {
	return lines.shape === 'marked' && 'head' in lines ? headedLines(lines) : lines;
}
