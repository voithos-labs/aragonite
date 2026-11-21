/**
 * `defineBlockView`: a block view drawn with plain DOM into an element the editor makes. The view
 * carries its host component, so a page with no such view never loads the DOM host.
 */
import {
	asBlockView,
	type BlockSurface,
	type BlockView,
	type BlockViewSpec
} from '../../schema/block-view';
import DomBlockHost from './DomBlockHost.svelte';

const SURFACES: readonly BlockSurface[] = ['container'];

/** A block view drawn by `spec`. Throws on a `surface` or `mount` it can't use. */
export function defineBlockView(spec: BlockViewSpec): BlockView {
	if (!SURFACES.includes(spec?.surface)) {
		throw new TypeError(
			`defineBlockView: \`surface\` must be one of ${SURFACES.map((s) => `'${s}'`).join(', ')}`
		);
	}
	if (typeof spec.mount !== 'function') {
		throw new TypeError('defineBlockView: `mount` must be a function');
	}
	return asBlockView({ spec: { ...spec } as BlockViewSpec, host: DomBlockHost }, 'dom');
}
