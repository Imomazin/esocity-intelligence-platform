import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildParityFixtures, serialiseParityFixtures } from "@/lib/ml/parity";

describe("cross-language parity fixtures", () => {
  it("are up to date with the TypeScript engines (run `pnpm parity:fixtures` if this fails)", () => {
    const onDisk = readFileSync(
      resolve(process.cwd(), "services/ml-api/tests/fixtures/parity.json"),
      "utf8",
    );
    expect(onDisk === serialiseParityFixtures(buildParityFixtures())).toBe(true);
  });
});
