import type { AmbientPrefix } from '../../../block-component';
import type { ListItemMetadata } from '../../../core/nodes';
import { devWarn } from '../../../dev-warn';

/** Matches the `.task-checkbox` slot and gap in editor.css; the two move together. */
export const TASK_HANGING_INDENT = '2.1em';

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
				// single source of truth: derive from the keyed marker (in the render memo key), not parallel taskChecked
				ariaChecked: isTaskMarkerChecked(metadata.taskMarker),
				// The painted box is taller than the text beside it; the grip centres on the box.
				dragAnchor: true,
				onClick: onToggle
			},
			// The list marker gets a span of its own so the rendered modes can collapse its width:
			// GitHub draws the box at the margin, not indented under a bullet that is not there.
			{ start: 0, end: boxStart, className: 'task-list-marker', onClick: () => {} }
		],
		// The painted box (editor.css): slot + gap + the marker's trailing space.
		indent: TASK_HANGING_INDENT
	};
}
