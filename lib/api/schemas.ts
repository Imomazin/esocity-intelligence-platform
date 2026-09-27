import { z } from "zod";

/** Shared request schemas for route handlers. */

export const symbolParamSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z.]{0,9}$/, "Symbol must be 1–10 letters");

export const matchIdParamSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,64}$/, "Invalid match id");

export const limitQuerySchema = z.coerce.number().int().min(1).max(200);
