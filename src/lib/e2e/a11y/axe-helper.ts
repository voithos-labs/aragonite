import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Rule-id-level ratchet: any violation whose rule id is NOT in the committed
// allowlist fails the gate. The allowlist only shrinks (each entry names why it
// is deferred + its milestone). Fails closed — an empty allowlist fails on any
// violation, a missing/unparseable file throws here.
const baseline = JSON.parse(
	readFileSync(new URL('./axe-baseline.json', import.meta.url), 'utf-8')
) as { allow: { id: string }[] };
const allowed = new Set<string>(baseline.allow.map((a) => a.id));

export async function expectNoNewA11yViolations(page: Page, label: string): Promise<void> {
	const results = await new AxeBuilder({ page }).include('.editor').analyze();
	const novel = results.violations.filter((v) => !allowed.has(v.id));
	if (novel.length > 0) {
		console.error(
			`[a11y:${label}] non-baselined violations:\n` +
				novel
					.map(
						(v) =>
							`  ${v.id} — ${v.help}\n` +
							v.nodes.map((n) => `    · ${n.target.join(' ')}`).join('\n')
					)
					.join('\n')
		);
	}
	expect(
		novel,
		`[a11y:${label}] new violations: ${novel.map((v) => `${v.id} (${v.nodes.length})`).join(', ')}`
	).toEqual([]);
}
