/**
 * `markerPair`: two plugin markers around ordinary text, in one block or in two. Each side is its
 * own construct, claimed by its own matcher wherever it stands; the plugin matches the sides up by
 * what they read, never the editor. A side draws nothing where markers hide, shows its bytes
 * where they show, and a letter typed at it joins the side its pair declares as its text.
 */
import { checkLocalName } from './block-shapes';
import { inline } from './inline-maker';
import { asMarkerSide, type FunctionMatcher, type Inline, type RegexMatcher } from './inline-type';

/** One side: what every claim of it starts with, and the matcher that claims it there. `D` is
 *  what `read` returns: the pair's name or id, for the plugin to match sides by. */
export type MarkerSide<D> = { prefix: string } & (RegexMatcher<D> | FunctionMatcher<D>);

export interface MarkerPairSpec<D> {
	/** Lowercase letters, digits and hyphens; the sides are named `name-open` and `name-close`. */
	name: string;
	label: string;
	open: MarkerSide<D>;
	close: MarkerSide<D>;
	/** The side of each marker a letter typed at it joins; by default the text between them. */
	text?: { open: 'after' | 'before'; close: 'before' | 'after' };
	/** Bytes the pair reads, for the published checks. */
	sample: string | readonly string[];
}

/** A marker pair as a plugin lists it in `Contribution.inlines`; `piece.is(pair.open)` finds a side. */
export interface MarkerPair<D = unknown> {
	readonly name: string;
	readonly open: Inline<D>;
	readonly close: Inline<D>;
}

type Sides<D, O, C> = Omit<MarkerPairSpec<D>, 'open' | 'close'> & {
	open: { prefix: string } & O;
	close: { prefix: string } & C;
};
type R<D> = RegexMatcher<D>;
type F<D> = FunctionMatcher<D>;

/** Makes a marker pair; each side is claimed where the text starts with its `prefix`. */
export function markerPair<D>(spec: Sides<D, R<D>, R<D>>): MarkerPair<D>;
export function markerPair<D>(spec: Sides<D, R<D>, F<D>>): MarkerPair<D>;
export function markerPair<D>(spec: Sides<D, F<D>, R<D>>): MarkerPair<D>;
export function markerPair<D>(spec: Sides<D, F<D>, F<D>>): MarkerPair<D>;
export function markerPair<D>(spec: MarkerPairSpec<D>): MarkerPair<D>;
export function markerPair<D>(spec: MarkerPairSpec<D>): MarkerPair<D> {
	checkLocalName('markerPair', spec.name);
	const text = spec.text ?? { open: 'after', close: 'before' };
	const side = (which: 'open' | 'close') =>
		asMarkerSide(
			inline<D>({
				...spec[which],
				name: `${spec.name}-${which}`,
				label: spec.label,
				sample: spec.sample,
				// A class construct claims and keeps its bytes; as a side they're drawn as a marker.
				class: ''
			}),
			text[which]
		);
	const open = side('open');
	const close = side('close');
	return Object.defineProperty({ open, close }, 'name', {
		enumerable: true,
		get: () => open.name.slice(0, -'-open'.length)
	}) as MarkerPair<D>;
}
