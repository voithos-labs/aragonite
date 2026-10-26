/**
 * Which inline widget shows its source in an editor: one range at a time, drawn by its block as the
 * bytes themselves, so keys inside it take the ordinary typed write. The range stays open while the
 * caret is inside it and the block keeps its kind; a mid-line `#few` that a Space turns into
 * `# few` stays a paragraph, so the range stays open over `# few` until the caret leaves.
 */

import type { NodeView } from '../../../core/node-views';
import type { RawRange } from '../../../browser/offsets';

interface OpenSource {
	path: string;
	start: number;
	/** Bytes after the range: an edit inside the range moves its end and leaves these alone. */
	tail: number;
	blockKind: string;
}

export interface ShownSourceState {
	/** The range the block at `path` draws as source, or null. Reactive. */
	rangeIn(path: readonly number[], node: NodeView): RawRange | null;
	/** Whether `offset` in the block at `path` sits inside the shown source, bounds included. */
	holds(path: readonly number[], node: NodeView, offset: number): boolean;
	open(path: readonly number[], node: NodeView, range: RawRange): void;
	/** Closes the range only if the block at `path` holds it. */
	close(path: readonly number[]): void;
}

export function createShownSourceState(): ShownSourceState {
	let open = $state<OpenSource | null>(null);

	function rangeIn(path: readonly number[], node: NodeView): RawRange | null {
		const shown = open;
		if (!shown || shown.path !== path.join() || shown.blockKind !== node.kind) return null;
		const end = node.raw.length - shown.tail;
		return end >= shown.start ? { start: shown.start, end } : null;
	}

	return {
		rangeIn,
		holds(path, node, offset) {
			const range = rangeIn(path, node);
			return range !== null && offset >= range.start && offset <= range.end;
		},
		open(path, node, range) {
			open = {
				path: path.join(),
				start: range.start,
				tail: node.raw.length - range.end,
				blockKind: node.kind
			};
		},
		close(path) {
			if (open?.path === path.join()) open = null;
		}
	};
}
