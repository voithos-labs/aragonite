/** `lineBlock`: a plugin block type that's exactly one line. */
import type { BlockType } from '../../schema/plugin-unit';
import { madeBlockType } from '../../schema/block-type';
import { drawnView } from '../drawn-block/drawn-view';
import { framedDrawing, type SourceFrame } from './framed-source';
import {
	checkLocalName,
	completerOf,
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
		}
	};
}

function markerSpan(text: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = 'md-marker';
	span.textContent = text;
	return span;
}

/** Makes a one-line block type; what it claims is the line it matched, so its bytes can't be wrong. */
export function lineBlock<D = never>(spec: LineBlockSpec<D>): BlockType<D> {
	checkLocalName('lineBlock', spec.name);
	const priority = priorityBefore(spec.before);
	const shape = lineShape(spec as LineBlockSpec<unknown>, priority);
	// With no `draw`, the line is the editor's own text block, its marker dimmed.
	const drawing = spec.draw
		? framedDrawing(spec as LineBlockSpec<unknown>, () => type, true, lineMarker(shape))
		: null;
	const type: BlockType<D> = madeBlockType<D>({
		local: spec.name,
		label: spec.label,
		icon: spec.icon,
		insert: spec.insert,
		chords: spec.chords,
		actions: spec.actions,
		priority,
		registration: leafRegistration(spec as LineBlockSpec<unknown>, {
			range: shape.range,
			multiLine: false
		}),
		view: drawing ? drawnView(drawing) : textBlockView(),
		openers: (kind) => [shape.opener(kind)],
		completer: completerOf(spec.complete, shape.claims),
		bodyRange: shape.range,
		writeData: shape.writeData
	});
	return type;
}
