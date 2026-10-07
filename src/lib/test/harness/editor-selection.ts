// Editor selections written as values, for tests that hand one to the editor or expect one back.

import type { EditorSelection } from '$lib/selection/primitives';

/** A collapsed caret at `offset` in the block at `path`. */
export const caretAt = (path: number[], offset: number): EditorSelection => ({
	anchor: { path, offset },
	focus: { path, offset }
});
