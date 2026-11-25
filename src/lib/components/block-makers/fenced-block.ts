/** `fencedBlock`: a plugin block type opened by one line and closed by a later one. */
import type { BlockType } from '../../schema/plugin-unit';
import { madeBlockType } from '../../schema/block-type';
import { drawnView } from '../drawn-block/drawn-view';
import { renderFencedSource } from '../blocks/code/code-renderer';
import { framedDrawing, type SourceFrame } from './framed-source';
import { OPENER_PRIORITIES } from '../../schema/opener-priorities';
import { fenceShape } from '../../schema/fence-shape';
import { bodyWriter } from './body-changes';
import {
	checkLocalName,
	completerOf,
	leafRegistration,
	priorityBefore,
	type FencedBlockSpec,
	type LeafCommon
} from '../../schema/block-shapes';

/** Makes a fenced block type; the editor finds its closer, grows a code fence's closer past a body
 *  line that would close it, and keeps every write of its bytes legal. */
export function fencedBlock<H = unknown>(spec: FencedBlockSpec<H>): BlockType<never> {
	checkLocalName('fencedBlock', spec.name);
	const fences = [spec.fence].flat();
	// A code fence's info string is the built-in code block's otherwise, so it's tried first.
	const takesCodeFences = fences.some((f) => 'info' in f);
	const priority = Math.min(
		priorityBefore(spec.before),
		takesCodeFences ? OPENER_PRIORITIES.fencedCode - 1 : Infinity
	);
	const shape = fenceShape(fences, priority, spec.interrupts ?? false);
	const drawing = framedDrawing(spec, () => type, false, fenceLines(shape));
	const type: BlockType<never> = madeBlockType<never>({
		local: spec.name,
		label: spec.label,
		icon: spec.icon,
		insert: spec.insert,
		chords: spec.chords,
		actions: spec.actions,
		priority,
		// The body on the descriptor too, which the range core and the empty-block hint read.
		registration: {
			...leafRegistration(spec as LeafCommon<unknown>, shape),
			bodyRange: shape.body
		},
		view: drawnView(drawing),
		openers: shape.openers,
		completer: completerOf(spec.complete, shape.claims),
		bodyRange: shape.body,
		writeBody: bodyWriter(shape.writeBody),
		oneLine: shape.oneLine
	});
	return type;
}

// The fence lines drawn as the code block draws its own, through the one reading of the fence; text
// no fence of the type opens is all body, and what follows the closer plain text.
function fenceLines(shape: ReturnType<typeof fenceShape>): SourceFrame {
	return {
		wrap(text, paintText) {
			const shown = shape.split(text) ?? { opener: '', body: text, closer: '', after: '' };
			const frag = renderFencedSource(shown, paintText);
			if (shown.after) frag.append(shown.after);
			return frag;
		},
		text: shape.bodyText,
		reshape: shape.reshape
	};
}
