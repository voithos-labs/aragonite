// svelte-package copies all of src/lib into dist, tests included; strip them before pack.
// The verify-pack negative gate catches any straggler this misses.
import { rmSync } from 'node:fs';

// plugins/README.md is the internal bundled-plugin tier doc; consumers read docs/guide.
for (const target of ['dist/test', 'dist/e2e', 'dist/plugins/README.md']) {
	rmSync(target, { recursive: true, force: true });
}
