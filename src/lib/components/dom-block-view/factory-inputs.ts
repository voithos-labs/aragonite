/**
 * Where a block drawn by `defineBlockView` gets each input of the leaf and container factories, so
 * an input added to either fails `npm run check` until a DOM view, and the React and Vue helpers
 * built on one, can supply it too.
 */

import type { ContainerBlockDeps } from '../../editor-actions/plugin/container';
import type { EditableLeafDeps } from '../blocks/editable/editable-leaf';

/** The DOM host itself, the view's spec, a call on its surface, its handle, or the kind's descriptor. */
type InputSource = 'host' | 'spec' | 'surface' | 'handle' | 'descriptor';

type KeysOfEach<T> = T extends unknown ? keyof T : never;

const _containerInputs = {
	getNode: 'host',
	getIndex: 'host',
	getPath: 'host',
	// The box `mountChildren` names, else the block's element.
	getBoxEl: 'surface',
	getFocusEl: 'surface',
	isCollapsed: 'descriptor',
	commandHooks: 'surface',
	getAmbientPrefix: 'spec'
} as const satisfies Record<keyof ContainerBlockDeps, InputSource>;

const _leafInputs = {
	getNode: 'host',
	getIndex: 'host',
	getPath: 'host',
	getEl: 'surface',
	mode: 'spec',
	singleLine: 'spec',
	commandHooks: 'surface',
	renderSource: 'spec',
	reshapeSource: 'spec',
	onSourceEdit: 'handle',
	isRevealed: 'host',
	setRevealed: 'host'
} as const satisfies Record<KeysOfEach<EditableLeafDeps>, InputSource>;
