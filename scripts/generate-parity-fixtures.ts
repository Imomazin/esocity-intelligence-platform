/**
 * Regenerate the cross-language parity fixtures consumed by services/ml-api/tests/test_parity.py.
 *
 *   pnpm parity:fixtures
 *
 * Run after changing any engine mirrored by the Python service (football model, indicators,
 * composite signal, backtester). tests/unit/parity-fixtures.test.ts fails until you do.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildParityFixtures, serialiseParityFixtures } from "@/lib/ml/parity";

const target = resolve(process.cwd(), "services/ml-api/tests/fixtures/parity.json");
const contents = serialiseParityFixtures(buildParityFixtures());
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, contents);
console.info(`Wrote ${target} (${(contents.length / 1024).toFixed(1)} KiB)`);
