/**
 * Where a drawn block gets each input of the editable-leaf factory, so an input added to it fails
 * `npm run check` until the draw host supplies it, or names the drawing's own route to it.
 */

import type { EditableLeafDeps } from '../blocks/editable/editable-leaf';

/** The draw host itself, the block type's spec, or the drawing's own `Drawn`. */
type InputSource = 'host' | 'spec' | 'drawn';

type KeysOfEach<T> = T extends unknown ? keyof T : never;

const _leafInputs = {
	getNode: 'host',
	getIndex: 'host',
	getPath: 'host',
	getEl: 'host',
	mode: 'spec',
	singleLine: 'spec',
	renderSource: 'spec',
	reshapeSource: 'spec',
	onSourceEdit: 'host',
	isRevealed: 'host',
	setRevealed: 'host',
	// A block type's own commands are handed `Drawn.handle` instead (`editor-contributions.ts`).
	commandHooks: 'drawn'
} as const satisfies Record<KeysOfEach<EditableLeafDeps>, InputSource>;
