/**
 * Where a block drawn by `defineBlockView` gets each input of the container factory, so an input
 * added to it fails `npm run check` until a DOM view can supply it too.
 */

import type { ContainerBlockDeps } from '../../editor-actions/plugin/container';

/** The DOM host itself, the view's spec, a call on its surface, the kind's descriptor, or none. */
type InputSource = 'host' | 'spec' | 'surface' | 'descriptor' | 'none';

const _containerInputs = {
	getNode: 'host',
	getIndex: 'host',
	getPath: 'host',
	// The box `mountChildren` names, else the block's element.
	getBoxEl: 'surface',
	getFocusEl: 'surface',
	isCollapsed: 'descriptor',
	commandHooks: 'surface',
	getAmbientPrefix: 'spec',
	// A DOM view's row keeps the look its own kind gives it.
	titleRow: 'none'
} as const satisfies Record<keyof ContainerBlockDeps, InputSource>;
