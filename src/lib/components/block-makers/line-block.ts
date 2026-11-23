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

// The line handed to the type's painting whole.
const WHOLE_LINE: SourceFrame = {
	wrap(text, paintText) {
		const frag = document.createDocumentFragment();
		frag.append(paintText(text));
		return frag;
	}
};

/** Makes a one-line block type; what it claims is the line it matched, so its bytes can't be wrong. */
export function lineBlock<D = never>(spec: LineBlockSpec<D>): BlockType<D> {
	checkLocalName('lineBlock', spec.name);
	const priority = priorityBefore(spec.before);
	const shape = lineShape(spec as LineBlockSpec<unknown>, priority);
	// With no `draw`, the line is the editor's own text block, its marker dimmed.
	const drawing = spec.draw
		? framedDrawing(spec as LineBlockSpec<unknown>, () => type, true, WHOLE_LINE)
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
