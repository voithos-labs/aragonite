/** `lineBlock`: a plugin block type that's exactly one line. */
import type { BlockType } from '../../schema/plugin-unit';
import type { NodeView } from '../../core/node-views';
import { trimTrailingLineEnding } from '../../core/lines';
import { madeBlockType } from '../../schema/block-type';
import { drawnView } from '../drawn-block/drawn-view';
import { framedDrawing, type SourceFrame } from './framed-source';
import { bodyWriter } from './body-changes';
import {
	checkLocalName,
	completerOf,
	editOf,
	leafRegistration,
	lineShape,
	priorityBefore,
	type LineBlockSpec
} from '../../schema/block-shapes';
import { textBlockView } from '../blocks/text/text-block-view';

// The line's marker drawn dimmed on each side of its text, as a text block draws its own.
function lineMarker(shape: ReturnType<typeof lineShape>): SourceFrame {
	return {
		wrap(text, paintText) {
			const { start, end } = shape.textIn(text);
			const frag = document.createDocumentFragment();
			if (start > 0) frag.append(markerSpan(text.slice(0, start)));
			frag.append(paintText(text.slice(start, end)));
			if (end < text.length) frag.append(markerSpan(text.slice(end)));
			return frag;
		},
		text(shown) {
			const { start, end } = shape.textIn(shown);
			return shown.slice(start, end);
		}
	};
}

function lineEnd(node: NodeView): { start: number; end: number } {
	const end = trimTrailingLineEnding(node.raw).length;
	return { start: end, end };
}

function markerSpan(text: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = 'md-marker';
	span.textContent = text;
	return span;
}

/** Makes a one-line block type; what it claims is the line it matched, so its bytes can't be wrong. */
export function lineBlock<D = never, H = unknown>(spec: LineBlockSpec<D, H>): BlockType<D> {
	checkLocalName('lineBlock', spec.name);
	const priority = priorityBefore(spec.before);
	const shape = lineShape(spec as LineBlockSpec<unknown>, priority);
	// A line that neither draws, paints nor opens its text is the editor's own text block.
	const drawing =
		spec.draw || spec.renderSource || editOf(spec) === 'source'
			? framedDrawing(spec as LineBlockSpec<unknown>, () => type, true, lineMarker(shape))
			: null;
	const type: BlockType<D> = madeBlockType<D>({
		local: spec.name,
		label: spec.label,
		icon: spec.icon,
		insert: spec.insert,
		chords: spec.chords,
		actions: spec.actions,
		commands: spec.commands,
		priority,
		registration: {
			...leafRegistration(spec as LineBlockSpec<unknown>, {
				range: shape.range,
				multiLine: false
			}),
			writeData: shape.writeData
		},
		view: drawing ? drawnView(drawing) : textBlockView(),
		openers: (kind) => [shape.opener(kind)],
		completer: completerOf(spec.complete, shape.claims),
		// A line with no text of its own has an empty body, as its open text is empty.
		bodyRange: shape.range ?? lineEnd,
		writeBody: bodyWriter(shape.writeBody)
	});
	return type;
}
