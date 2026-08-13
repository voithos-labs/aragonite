/**
 * CSS↔TS parity for the hidden-run predicate: `cursor/widget-offset.ts` mirrors the
 * stylesheet's class scoping structurally, because a getComputedStyle per keystroke is
 * unaffordable — so the two can drift. This probe pays for the comparison once per mode
 * change, per marker family, over three answers: the stylesheet's, the walk's, and the
 * node-space model both are stated over. It declines wherever no stylesheet demonstrably hides
 * anything (jsdom, source mode); the presentation e2e battery is the real assertion there.
 */

import type { InvariantViolation } from './assert';
import { familyHidesText, markerFamilyOf, type VisibilityContext } from '../core/inline/visibility';
import {
	CONTENT_EMPTY_ATTR,
	isHiddenMarkerRoot,
	screenVisibilityOf
} from '../cursor/widget-offset';

interface ProbeCase {
	name: string;
	family: string;
	focusedHost: boolean;
	attrs?: Record<string, string>;
	reveal?: boolean;
	/** The block holds only chrome, so two of the three families paint (a ref label does not). */
	contentEmpty?: boolean;
}

/** One case per stylesheet arm the predicate mirrors, both host-focus states. */
const CASES: ProbeCase[] = ['md-marker', 'md-fence-line', 'md-ref-label'].flatMap((family) => [
	{ name: family, family, focusedHost: false },
	{ name: `${family} (focused host)`, family, focusedHost: true },
	{ name: `${family} (content-empty block)`, family, focusedHost: false, contentEmpty: true },
	...(family === 'md-marker'
		? [
				{
					name: 'stamped construct marker (focused host)',
					family,
					focusedHost: true,
					attrs: { 'data-construct-start': '' }
				},
				{
					name: 'revealed construct marker (focused host)',
					family,
					focusedHost: true,
					attrs: { 'data-construct-start': '' },
					reveal: true
				}
			]
		: [])
]);

export function checkMarkerCssParity(editorRoot: HTMLElement): InvariantViolation | null {
	const probes = CASES.map((probe) => mountProbe(editorRoot, probe));
	try {
		const read = probes.map(({ probe, span, block }) => ({
			name: probe.name,
			predicate: isHiddenMarkerRoot(span, block),
			// The model claims the families and the chrome fold; the REVEAL arms are the walk's
			// alone, so a focused host is where the two are allowed to differ.
			model: probe.focusedHost ? null : modelHides(span, screenVisibilityOf(block)),
			css: getComputedStyle(span).display === 'none'
		}));
		// No case computes hidden: either source mode (nothing hides by design) or an engine
		// that applies no stylesheet — no signal to compare against, so the probe stands down.
		if (!read.some((entry) => entry.css)) return null;
		const diverged = read.find(
			(entry) =>
				entry.predicate !== entry.css || (entry.model !== null && entry.model !== entry.css)
		);
		if (!diverged) return null;
		return {
			code: 'marker-css-parity',
			message: `the hidden-run answers disagree about "${diverged.name}" — the families in core/inline/visibility.ts, the walk in cursor/widget-offset.ts and styles/editor.css moved apart`,
			detail: read
		};
	} finally {
		for (const { host } of probes) host.remove();
	}
}

function mountProbe(
	editorRoot: HTMLElement,
	probe: ProbeCase
): { probe: ProbeCase; host: HTMLElement; block: HTMLElement; span: HTMLElement } {
	const host = document.createElement('div');
	host.className = 'block-host';
	if (probe.focusedHost) host.setAttribute('data-focused', '');
	host.setAttribute('aria-hidden', 'true');
	host.style.position = 'absolute';
	host.style.left = '-9999px';
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	if (probe.contentEmpty) block.setAttribute(CONTENT_EMPTY_ATTR, '');
	const span = document.createElement('span');
	span.className = probe.reveal ? `${probe.family} md-construct-reveal` : probe.family;
	for (const [name, value] of Object.entries(probe.attrs ?? {})) span.setAttribute(name, value);
	block.appendChild(span);
	host.appendChild(block);
	editorRoot.appendChild(host);
	return { probe, host, block, span };
}

function modelHides(span: Element, ctx: VisibilityContext): boolean {
	const family = markerFamilyOf(span);
	return family !== null && familyHidesText(family, ctx);
}
