/**
 * Document-scoped GitHub-alert conversion — the transform behind the host's
 * convert affordance (the docs' sanctioned rewrite pattern: `getSource()` →
 * transform → write the `source` prop back).
 *
 * Scoping through `parse` instead of raw line scanning means only real
 * top-level blockquote blocks convert: an alert-shaped line inside a code
 * fence stays untouched. Blockquotes nested inside other containers are left
 * alone — rewriting one would require rebuilding its ancestors' raw, and
 * GitHub alerts are a top-level construct in practice.
 */
import { parse, type PasteTransform } from '$lib/plugin';
import { convertAlertBlockquoteRaw, hasGithubAlert, type AlertConversion } from './gh-alert';

export function convertGithubAlertsInDocument(source: string): AlertConversion {
	const doc = parse(source);
	let changed = false;
	const parts: string[] = [doc.prefix];
	for (const child of doc.children) {
		parts.push(child.leadingTrivia);
		const converted = child.kind === 'blockquote' ? convertAlertBlockquoteRaw(child.raw) : null;
		if (converted !== null) {
			parts.push(converted);
			changed = true;
		} else {
			parts.push(child.raw);
		}
	}
	parts.push(doc.suffix);
	return { converted: parts.join(''), changed };
}

/**
 * The admonitions paste transform: rewrite pasted GitHub-alert blockquotes into
 * `:::name` source before the editor parses. The cheap line probe short-circuits
 * the common no-alert paste; the CST-scoped converter is fence-safe, so an
 * alert-shaped line pasted inside a code fence stays literal.
 */
export const githubAlertsPasteTransform: PasteTransform = {
	name: 'admonitions.github-alerts',
	transform(text) {
		if (!hasGithubAlert(text)) return null;
		const { converted, changed } = convertGithubAlertsInDocument(text);
		return changed ? converted : null;
	}
};
