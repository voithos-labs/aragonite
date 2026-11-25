/**
 * GitHub-alert conversion over a whole document, and the supported way to rewrite one:
 * `getSource()` → transform → write the `source` prop back. It reads the document as an editor
 * listing `admonitions` does, whatever else the page has turned on, so it is fence-safe and an
 * alert inside a box or a quote stays, since rewriting one would mean rebuilding what holds it.
 */
import { grammar } from '@voithos-labs/aragonite/plugin';
import { admonitions, alertsAsBoxes } from './admonitions-plugin';
import type { AlertConversion } from './gh-alert';

export function convertGithubAlertsInDocument(source: string): AlertConversion {
	const converted = alertsAsBoxes(grammar([admonitions]).parse(source));
	return converted === null ? { converted: source, changed: false } : { converted, changed: true };
}
