import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/** Shared column builders so every table follows the same conventions. */

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestampTz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Monetary amounts (base currency). */
export const money = (name: string) => numeric(name, { precision: 20, scale: 6, mode: "number" });

/** Instrument prices. */
export const price = (name: string) => numeric(name, { precision: 18, scale: 6, mode: "number" });

/** Quantities (supports fractional units for future asset classes). */
export const quantity = (name: string) =>
  numeric(name, { precision: 20, scale: 6, mode: "number" });

/** Probabilities in [0, 1]. */
export const probability = (name: string) =>
  numeric(name, { precision: 8, scale: 6, mode: "number" });

/** Generic ratios, scores and rates (returns, Sharpe, basis points…). */
export const ratio = (name: string) => numeric(name, { precision: 14, scale: 6, mode: "number" });
