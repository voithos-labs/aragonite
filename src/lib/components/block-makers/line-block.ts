/** `lineBlock`: a plugin block type that's exactly one line, drawn as editable text. */
import type { BlockType } from '../../schema/plugin-unit';
import { madeBlockType } from '../../schema/block-type';
import {
	checkLocalName,
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
	return madeBlockType<D>({
		local: spec.name,
		label: spec.label,
		priority,
		registration: leafRegistration(spec, shape.range, false),
		view: textBlockView(),
		opener: shape.opener
	});
}
