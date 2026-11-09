/**
 * Mounts a decoration's widget or badge view into the element the editor made for it, so block
 * badges and inline widgets report a failing view the same way.
 */

import { mountPluginView, type MountedPluginView, type PluginView } from '../plugin-view';
import type { Paint } from './paint';
import { paintBehind } from './plugin-paint.svelte';
import type { Decoration, DecorationWidgetSpec } from './types';

export type MountedDecorationWidget = MountedPluginView<{ decoration: Decoration }>;

/** Null when the view threw while mounting, which `report` was told; the caller leaves it out. */
export function mountDecorationWidget(
	spec: DecorationWidgetSpec,
	dec: Decoration,
	target: HTMLElement,
	report: (error: unknown) => void
): MountedDecorationWidget | null {
	const opts = { report, subject: 'decoration widget' };
	const paint = paintBehind(dec);
	if (!paint) return mountPluginView(spec.view, target, { decoration: dec }, opts);
	// A plugin's paint view is told the paint it came from.
	const view = spec.view as unknown as PluginView<{ paint: Paint }>;
	const mounted = mountPluginView(view, target, { paint }, opts);
	return (
		mounted && {
			update: (next) => mounted.update({ paint: paintBehind(next.decoration) ?? paint }),
			destroy: () => mounted.destroy()
		}
	);
}
