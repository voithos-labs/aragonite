/**
 * GitHub-alert conversion over a whole document, and the supported way to rewrite one:
 * `getSource()` → transform → write the `source` prop back. Going through `parse` rather
 * than scanning lines is what makes it fence-safe; nested alerts are skipped because
 * rewriting one would mean rebuilding its ancestors' raw.
 */
import { documentLineEnding, parse, type PasteTransform } from '$lib/plugin';
import { convertAlertBlockquoteRaw, hasGithubAlert, type AlertConversion } from './gh-alert';

export function convertGithubAlertsInDocument(source: string): AlertConversion {
	const doc = parse(source, { scope: 'document' });
	const ending = documentLineEnding(doc);
	let changed = false;
	const parts: string[] = [doc.prefix];
	for (const child of doc.children) {
		parts.push(child.leadingTrivia);
		// Both kinds feed the same first-line converter: a plain blockquote may still
		// hold a mid-quote marker, which must stay literal.
		const isAlertShaped = child.kind === 'blockquote' || child.kind === 'githubAlert';
		const converted = isAlertShaped ? convertAlertBlockquoteRaw(child.raw, ending) : null;
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

/** The line scan short-circuits the common no-alert paste before the parse. */
export const githubAlertsPasteTransform: PasteTransform = {
	name: 'admonitions.github-alerts',
	transform(text) {
		if (!hasGithubAlert(text)) return null;
		const { converted, changed } = convertGithubAlertsInDocument(text);
		return changed ? converted : null;
	}
};
