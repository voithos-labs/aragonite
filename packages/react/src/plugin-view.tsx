'use client';

import { createElement, type ComponentType } from 'react';
import type { PluginView } from '@voithos-labs/aragonite/plugin';
import { createViewRoot, type Wrap } from './view-root.js';

export interface ReactViewOptions {
	/** Wraps the component, for providers: the view renders in a React root of its own, which a
	 *  provider in the host app doesn't reach. */
	wrap?: Wrap;
}

/** An inline widget, decoration widget or badge, or menu row drawn by `Component`, with the slot's
 *  props; it fits any slot whose props include the ones it declares. Each `update` re-renders it. */
export function reactView<P extends object>(
	Component: ComponentType<P>,
	options: ReactViewOptions = {}
): PluginView<P> {
	return (target, props) => {
		const root = createViewRoot(target, options.wrap);
		const draw = (next: P) => root.render(createElement(Component, next));
		draw(props);
		return { update: draw, destroy: root.unmount };
	};
}
