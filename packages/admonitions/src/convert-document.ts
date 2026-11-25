/**
 * GitHub-alert conversion over a whole document, and the supported way to rewrite one:
 * `getSource()` → transform → write the `source` prop back. Going through `parse` rather
 * than scanning lines is what makes it fence-safe; nested alerts are skipped because
 * rewriting one would mean rebuilding its ancestors' raw.
 */
import { documentLineEnding, parse } from '@voithos-labs/aragonite/plugin';
import { convertAlertBlockquoteRaw, type AlertConversion } from './gh-alert';

export function convertGithubAlertsInDocument(source: string): AlertConversion {
	const doc = parse(source, { scope: 'document' });
	const ending = documentLineEnding(doc);
	let changed = false;
	const parts: string[] = [doc.prefix];
	for (const child of doc.children) {
		parts.push(child.leadingTrivia);
		// The page's grammar reads an alert as a quote; the first-line converter keeps a marker
		// further down literal.
		const converted =
			child.kind === 'blockquote' ? convertAlertBlockquoteRaw(child.raw, ending) : null;
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
