/**
 * Where a drawn block gets each input of the editable-leaf factory, so an input added to it fails
 * `npm run check` until the draw host supplies it, or says why a drawing can't have it yet.
 */

import type { EditableLeafDeps } from '../blocks/editable/editable-leaf';

/** The draw host itself, the block type's spec, or no route into a drawing yet. */
type InputSource = 'host' | 'spec' | 'none-yet';

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
	// A block command's view hooks reach a drawing once block types carry their own chords.
	commandHooks: 'none-yet'
} as const satisfies Record<KeysOfEach<EditableLeafDeps>, InputSource>;
