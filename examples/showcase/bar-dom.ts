// Element builders for the demo site's bars, which are plain DOM so every host mounts one copy.
import { BAR_ICONS, type BarIconName } from './bar-icons';

/** An attribute map: `false` or `undefined` removes the attribute, `true` sets it empty. */
export type Attrs = Record<string, string | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Attrs = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	setAttrs(node, attrs);
	node.append(...children);
	return node;
}

export function setAttrs(node: Element, attrs: Attrs): void {
	for (const [name, value] of Object.entries(attrs)) {
		if (value === undefined || value === false) node.removeAttribute(name);
		else node.setAttribute(name, value === true ? '' : value);
	}
}

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name: BarIconName, size = 15): SVGSVGElement {
	const svg = document.createElementNS(SVG, 'svg');
	const attrs: Record<string, string> = {
		viewBox: '0 0 24 24',
		width: String(size),
		height: String(size),
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': '1.75',
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		'aria-hidden': 'true'
	};
	for (const [name, value] of Object.entries(attrs)) svg.setAttribute(name, value);
	for (const d of BAR_ICONS[name]) {
		const path = document.createElementNS(SVG, 'path');
		path.setAttribute('d', d);
		svg.append(path);
	}
	return svg;
}
