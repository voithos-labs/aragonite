import { describe, it, expect } from 'vitest';
import * as pluginBarrel from '$lib/plugin';
import type {
	EditEvent,
	EditorEventMap,
	SelectionChangeEvent,
	EditorError,
	OperationKind
} from '$lib/plugin';

// The event surface is unstable (pre-freeze). This probe pins the payload types a plugin's
// `edit` handler needs, so a dropped re-export fails here rather than degrading `op` to a bare
// string in a downstream plugin.
describe('@voithos-labs/aragonite/plugin event payloads', () => {
	it('keeps the emitter itself off the barrel — a plugin subscribes, never emits', () => {
		for (const seam of ['createEditorEvents', 'toEditEvent', 'EditorEvents']) {
			expect(pluginBarrel).not.toHaveProperty(seam);
		}
	});

	it('narrows an edit handler against the operation vocabulary (compile-time contract)', () => {
		const kind: OperationKind = 'updateContent';
		const event: EditEvent = {
			op: 'updateContent',
			path: [0],
			detail: { length: 3 },
			timestamp: 0
		};
		// The correlation: narrowing `op` narrows `detail` with it, so this reads a field only
		// the `updateContent` arm has.
		const length = event.op === 'updateContent' ? event.detail.length : -1;

		const handlers: {
			[K in keyof EditorEventMap]?: (payload: EditorEventMap[K]) => void;
		} = {
			edit: (e) => e.path,
			selectionChange: (sel: SelectionChangeEvent) => sel?.anchor.offset,
			error: (err: EditorError) => err.origin
		};

		expect(kind).toBe(event.op);
		expect(length).toBe(3);
		expect(Object.keys(handlers)).toHaveLength(3);
	});
});
