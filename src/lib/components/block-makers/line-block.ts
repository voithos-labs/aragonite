/** `lineBlock`: a plugin block type that's exactly one line. */
import type { BlockType } from '../../schema/plugin-unit';
import { madeBlockType } from '../../schema/block-type';
import { drawnView } from '../../schema/drawing';
import {
	checkLocalName,
	completerOf,
	leafDrawing,
	leafRegistration,
	lineShape,
	priorityBefore,
	type LineBlockSpec
} from '../../schema/block-shapes';
import { textBlockView } from '../blocks/text/text-block-view';

/** Makes a one-line block type; what it claims is the line it matched, so its bytes can't be wrong. */
export function lineBlock<D = never>(spec: LineBlockSpec<D>): BlockType<D> {
	checkLocalName('lineBlock', spec.name);
	const priority = priorityBefore(spec.before);
	const shape = lineShape(spec as LineBlockSpec<unknown>, priority);
	const drawing = leafDrawing(spec as LineBlockSpec<unknown>, () => type, true);
	const type: BlockType<D> = madeBlockType<D>({
		local: spec.name,
		label: spec.label,
		insert: spec.insert,
		priority,
		registration: leafRegistration(spec as LineBlockSpec<unknown>, {
			range: shape.range,
			multiLine: false
		}),
		view: drawing ? drawnView(drawing) : textBlockView(),
		opener: shape.opener,
		completer: completerOf(spec.complete, shape.claims),
		bodyRange: shape.range,
		writeData: shape.writeData
	});
	return type;
}
