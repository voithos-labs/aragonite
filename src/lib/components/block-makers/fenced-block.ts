/** `fencedBlock`: a plugin block type opened by one line and closed by a later one. */
import type { BlockType } from '../../schema/plugin-unit';
import { madeBlockType } from '../../schema/block-type';
import { drawnView } from '../../schema/drawing';
import { OPENER_PRIORITIES } from '../../schema/opener-priorities';
import { fenceShape } from '../../schema/fence-shape';
import {
	checkLocalName,
	completerOf,
	leafDrawing,
	leafRegistration,
	priorityBefore,
	type FencedBlockSpec
} from '../../schema/block-shapes';
import { textBlockView } from '../blocks/text/text-block-view';

/** Makes a fenced block type; the editor finds its closer, grows a code fence's closer past a body
 *  line that would close it, and keeps every write of its bytes legal. */
export function fencedBlock(spec: FencedBlockSpec): BlockType<never> {
	checkLocalName('fencedBlock', spec.name);
	const fences = [spec.fence].flat();
	// A code fence's info string is the built-in code block's otherwise, so it's tried first.
	const takesCodeFences = fences.some((f) => 'info' in f);
	const priority = Math.min(
		priorityBefore(spec.before),
		takesCodeFences ? OPENER_PRIORITIES.fencedCode - 1 : Infinity
	);
	const shape = fenceShape(fences, priority, spec.interrupts ?? false);
	const drawing = leafDrawing(spec, () => type, false);
	const type: BlockType<never> = madeBlockType<never>({
		local: spec.name,
		label: spec.label,
		insert: spec.insert,
		priority,
		registration: leafRegistration(spec, shape),
		view: drawing ? drawnView(drawing) : textBlockView(),
		opener: shape.opener,
		completer: completerOf(spec.complete, shape.claims),
		bodyRange: shape.range
	});
	return type;
}
