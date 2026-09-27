/**
 * Minimal structured logger. Emits single-line JSON in production (ingested by Vercel log
 * drains / any log platform) and readable lines in development. Errors are serialised with
 * name + message (+ stack outside production). Never pass secrets into log context.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): Level {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : "info";
}

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(process.env.NODE_ENV === "production" ? {} : { stack: value.stack }),
      ...(value.cause ? { cause: serialise(value.cause) } : {}),
    };
  }
  return value;
}

function emit(level: Level, event: string, context: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;
  const payload = Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, serialise(value)]),
  );
  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify({ level, event, time: new Date().toISOString(), ...payload })
      : `[${level}] ${event}${Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : ""}`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  debug: (event: string, context?: Record<string, unknown>) => emit("debug", event, context),
  info: (event: string, context?: Record<string, unknown>) => emit("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => emit("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => emit("error", event, context),
};
