// svelte-package copies all of src/lib — including src/lib/test and src/lib/e2e —
// into dist. Tests must not ship; strip them before pack. The verify-pack negative
// gate catches any straggler this misses.
import { rmSync } from 'node:fs';

for (const dir of ['dist/test', 'dist/e2e']) {
	rmSync(dir, { recursive: true, force: true });
}
