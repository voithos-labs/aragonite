/**
 * Whether paint addressed to a block can render there. Marks, widgets and replaced ranges land only
 * on a block without children (a container's children paint themselves), and an inline widget only
 * in a prose block, inside its content. Paint that can't land is left out with a dev warning.
 */
import { contentLengthOf, isProseKind } from '../core/inline';
import type { NodeView } from '../core/node-views';

/** Why an inline widget at offset `start`, or a replaced range `start`..`end`, won't render in
 *  `node`, or null when it will. `contentEnd` is the offset the block's content ends at. */
export function inlineWidgetMiss(
	node: NodeView,
	start: number,
	end?: number
): { reason: 'non-prose' | 'past-content'; contentEnd: number } | null {
	// Non-prose kinds run no inline pass, so they apply no inline widgets.
	if (!isProseKind(node.kind)) return { reason: 'non-prose', contentEnd: 0 };
	// An end offset, not a count: a heading's content starts past its marker.
	const contentEnd = contentLengthOf(node);
	const fits =
		end === undefined
			? start >= 0 && start <= contentEnd
			: start >= 0 && start < end && end <= contentEnd;
	return fits ? null : { reason: 'past-content', contentEnd };
}

/** Whether `node` paints only its own classes: its children paint their own marks and widgets. */
export function paintsOnlyClasses(node: NodeView): boolean {
	return (node.children?.length ?? 0) > 0;
}
