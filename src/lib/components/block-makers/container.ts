/** `container`: a plugin block type whose content is other blocks. */
import type { BlockType } from '../../schema/plugin-unit';
import { madeBlockType, type BlockRow } from '../../schema/block-type';
import type { Drawing } from '../../schema/drawing';
import { drawnView } from '../drawn-block/drawn-view';
import { checkLocalName, completerOf, priorityBefore } from '../../schema/block-shapes';
import {
	ambientMarker,
	containerRegistration,
	type Closable,
	type ContainerSpec
} from '../../schema/container-block';
import { stripClaims, stripOpener, type ContainerLines } from '../../core/parsers/strip-container';
import { headedLines } from '../../schema/headed-lines';
import {
	READS_LINES,
	type ColonLines,
	type FencedLines,
	type IndentedLines,
	type MarkedLines
} from '../../core/strip-lines';
import type { CstNode, PluginBlockKind } from '../../core/nodes';
import { writeContainerRaw } from '../../schema/container-writer';
import { cloneNode } from '../../tree-operations/clone';
import { titleRowKind, titleRowRegistration } from '../../schema/title-row-leaf';
import type { FencedTitle } from '../../schema/fence-shape';
import { textBlockView } from '../blocks/text/text-block-view';

/** Makes a container block type; the editor reads and writes its lines from `lines`, so the plugin
 *  never writes its bytes. */
export function container<D extends object = never>(spec: ContainerSpec<D>): BlockType<D> {
	checkLocalName('container', spec.name);
	const priority = priorityBefore(spec.before);
	const lines = writtenLines(spec.lines);
	const fenced = lines.shape === 'fenced' ? lines[READS_LINES] : null;
	const colon = lines.shape === 'colon' ? colonReading(spec.name, lines) : null;
	const drawing: Drawing = {
		type: () => type,
		edit: 'container',
		singleLine: false,
		draw: (spec.draw as Drawing['draw'] | undefined) ?? ((_block, ctx) => ({ dom: children(ctx) })),
		// The editor's own drawing reads no answers, so a spec with no `draw` starts no watch.
		depends: spec.draw && spec.depends,
		...(spec.closable && { closable: spec.closable as Closable<unknown> }),
		...(colon && { titleRow: colon.title }),
		...(lines.shape === 'indented'
			? { ambientPrefix: (node, host) => ambientMarker(lines, node, host) }
			: {})
	};
	const strip = spec.lines as ContainerLines<D>;
	const row = fenced?.title ? titleRowParts(fenced.title) : null;
	const type: BlockType<D> = madeBlockType<D>({
		local: spec.name,
		label: spec.label,
		icon: spec.icon,
		insert: spec.insert,
		chords: spec.chords,
		actions: spec.actions,
		priority,
		registration: containerRegistration(spec as ContainerSpec<object>, lines, () =>
			colon ? colon.row : titleRowKind(type.name as PluginBlockKind)
		),
		view: drawnView(drawing),
		openers: (kind) =>
			colon
				? colon.openers()
				: [
						fenced
							? fenced.opener(kind, priority, spec.interrupts ?? false)
							: stripOpener(kind, strip, priority, spec.interrupts ?? false)
					],
		completer: completerOf(spec.complete, (written) =>
			colon ? colon.claims(written) : fenced ? fenced.claims(written) : stripClaims(strip, written)
		),
		rows: (kind) => (row ? [{ kind: titleRowKind(kind), ...row }] : []),
		colonNames: colon?.names,
		writeData(node, data, grammar) {
			// A colon type's data is the name its opening line spells, the one part of the row it reads.
			if (colon) return colon.renamed(node.raw, (data as { name: string }).name);
			const copy = cloneNode(node);
			copy.metadata = data as CstNode['metadata'];
			writeContainerRaw(copy, grammar);
			return copy.raw;
		}
	});
	return type;
}

const children = (ctx: object): HTMLElement => (ctx as { children: HTMLElement }).children;

/** What the title row of a titled fenced container declares and draws, named and classed as its
 *  title line says. */
const titleRowParts = (title: FencedTitle): Omit<BlockRow, 'kind'> => ({
	registration: titleRowRegistration({ label: title.label ?? 'Title' }),
	view: textBlockView({ blockClass: title.className ?? 'title-row' })
});

// A head line brings its own writer.
function writtenLines<D extends object>(
	lines: ContainerLines<D> | FencedLines<D> | ColonLines
): MarkedLines | IndentedLines<D> | FencedLines<D> | ColonLines {
	return lines.shape === 'marked' && 'head' in lines ? headedLines(lines) : lines;
}

// `COLON_LINES` writes a registered kind's lines; a maker's type reads its names from `colonLines`.
function colonReading(name: string, lines: ColonLines) {
	const reading = lines[READS_LINES];
	if (!reading) throw new Error(`container "${name}": colon lines come from colonLines({ names })`);
	return reading;
}
