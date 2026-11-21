/**
 * Paints a code body through the editor's highlighters: the code block's body and every plugin
 * source view (`renderSource`'s `paint`) come here. A language no highlighter lists paints plain.
 * An answer that arrives later is drawn only while the surface still shows the body and language
 * it was asked for.
 */

import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import type { CodePainter, CodeToken } from '../../../schema/code-highlighter';
import type { PluginActivation } from '../../../schema/plugin-activation';
import { isThenable } from '../../../schema/editor-contributions';
import { languageOwner } from './code-languages';

/** A painter for one surface; `repaint` draws the surface again once a waited answer arrives. */
export function createCodePainter(
	activation: () => PluginActivation,
	repaint: () => void
): CodePainter {
	let asked: string | null = null;
	let arrived: { key: string; tokens: readonly CodeToken[] } | null = null;
	return {
		code(body, language) {
			const key = `${language}\n${body}`;
			asked = key;
			if (arrived?.key === key) return drawTokens(body, arrived.tokens);
			const owner = languageOwner(language, activation());
			const answer = !owner || body === '' ? null : owner.highlight(body);
			if (!isThenable(answer)) return answer ? drawTokens(body, answer) : plain(body);
			void answer.then((tokens) => {
				if (asked !== key || !tokens) return;
				arrived = { key, tokens };
				repaint();
			});
			return plain(body);
		}
	};
}

const plain = (body: string): Node => document.createTextNode(body);

/** Each token as a span around its slice of `body`, nested as the tokens nest; every character of
 *  `body` is drawn once, so a token out of order or crossing its parent is dropped. */
export function drawTokens(body: string, tokens: readonly CodeToken[]): DocumentFragment {
	const frag = document.createDocumentFragment();
	const open: { el: ParentNode; to: number }[] = [{ el: frag, to: body.length }];
	let at = 0;
	// Text up to the innermost open run's end goes inside it; then that run closes.
	const close = () => {
		const { el, to } = open.pop()!;
		if (to > at) el.appendChild(document.createTextNode(body.slice(at, to)));
		at = Math.max(at, to);
	};
	const textTo = (end: number) => {
		if (end > at)
			open[open.length - 1].el.appendChild(document.createTextNode(body.slice(at, end)));
		at = Math.max(at, end);
	};
	const sorted = [...tokens].sort((a, b) => a.from - b.from || b.to - a.to);
	for (const token of sorted) {
		while (open.length > 1 && open[open.length - 1].to <= token.from) close();
		if (token.from < at || token.to <= token.from || token.to > open[open.length - 1].to) {
			devWarn('code-token-order', `dropped the token at ${token.from}..${token.to}: out of order`);
			continue;
		}
		textTo(token.from);
		const span = document.createElement('span');
		span.className = token.class;
		open[open.length - 1].el.appendChild(span);
		open.push({ el: span, to: token.to });
	}
	while (open.length > 0) close();
	return frag;
}
