import { rmSync } from 'node:fs';
// Explicit generated directories only; retain source, SDK, and downloaded deps.
for (const path of ['dist', '.build', 'public/engine', 'public/licenses', 'test-results', 'playwright-report']) {
  rmSync(new URL(`../${path}`, import.meta.url), { recursive: true, force: true });
}
