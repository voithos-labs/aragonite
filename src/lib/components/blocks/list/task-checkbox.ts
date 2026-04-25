import type { AmbientPrefix } from '../../../contracts';
import type { ListItemMetadata } from '../../../core/nodes';
import { devWarn } from '../../../diagnostics/dev-warn';

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
				ariaChecked: metadata.taskChecked,
				onClick: onToggle
			}
		]
	};
}
