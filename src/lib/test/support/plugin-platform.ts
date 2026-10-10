// Vitest setup: every unit test starts from the bootstrapped plugin platform, the built-ins and
// nothing else. Registered here because a unit test imports schema modules directly, never the
// editor or the inline parser entry that register them in production; the reset keeps them.
import { beforeEach } from 'vitest';
import { registerBuiltInDescriptors } from '#lib/schema/built-in-descriptors.js';
// The reset `resetPluginPlatformForTests` runs, imported bare: the testing barrel would load the
// modules a test file mocks before its `vi.mock` could apply.
import { __resetSchemaRegistriesForTests } from '#lib/schema/registry-reset.js';

registerBuiltInDescriptors();

// Before each test rather than after, so a registration made at a test file's load or in its
// `beforeAll` is gone for every test alike, and a failed teardown hook cannot leak into the next.
beforeEach(__resetSchemaRegistriesForTests);
