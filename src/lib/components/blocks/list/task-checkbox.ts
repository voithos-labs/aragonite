import type { AmbientPrefix } from '../../../block-component';
import type { ListItemMetadata } from '../../../core/nodes';
import { devWarn } from '../../../dev-warn';

/** Matches the `.task-checkbox` width and gap in editor.css; the two move together, both off the
 *  editor's own text size, since the first child may scale its text (a heading). */
export const TASK_HANGING_INDENT = 'calc(2.1 * var(--editor-font-size, 1rem))';

function isTaskMarkerChecked(taskMarker: string): boolean {
	const c = taskMarker[1];
	return c === 'x' || c === 'X';
}

export function buildTaskItemAmbient(
	metadata: ListItemMetadata | undefined,
	onToggle: () => void
): AmbientPrefix {
	const listMarker = metadata?.marker ?? '- ';

	const taskMarkerPresent = metadata?.taskMarker != null;
	if (metadata && metadata.taskItem !== taskMarkerPresent) {
		devWarn('ListItemBlock', 'taskItem / taskMarker inconsistent — rendering as plain list item', {
			taskItem: metadata.taskItem,
			taskMarker: metadata.taskMarker
		});
	}

	if (!metadata?.taskItem || !metadata.taskMarker) {
		return listMarker;
	}

	const boxStart = listMarker.length;
	return {
		text: listMarker + metadata.taskMarker,
		interactive: [
			{
				start: boxStart,
				end: boxStart + 3,
				className: 'task-checkbox',
				role: 'checkbox',
				// One source of truth: read the marker that is already in the render key, not a
				// second `taskChecked` field beside it
				ariaChecked: isTaskMarkerChecked(metadata.taskMarker),
				// The drawn box is taller than the text beside it, so it centres on the box.
				dragAnchor: true,
				onClick: onToggle
			},
			// The list marker gets a span of its own so the rendered modes can collapse it:
			// GitHub draws the box at the margin, not indented under a bullet that is not there.
			{ start: 0, end: boxStart, className: 'task-list-marker', onClick: () => {} }
		],
		// The drawn box (editor.css): its width, the gap, and the marker's trailing space.
		indent: TASK_HANGING_INDENT
	};
}
