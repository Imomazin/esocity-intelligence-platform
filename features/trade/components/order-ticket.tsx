"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { placePaperOrderAction } from "@/features/trade/actions";
import type { TradableQuote } from "@/features/trade/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { commissionFor, simulatedFillPrice, type ExecutionConfig } from "@/lib/trade/execution";
import type { OrderSide } from "@/lib/trade/types";
import { cn } from "@/lib/utils";

interface OrderTicketProps {
  quotes: TradableQuote[];
  cash: number;
  holdings: Record<string, number>;
  holdingsValue: number;
  execution: ExecutionConfig;
  limits: { maxQuantity: number; concentrationWarning: number };
  defaultSymbol?: string;
  /** What the reference price is, e.g. "the current demo quote". */
  quoteLabel?: string;
}

/**
 * PAPER order ticket. The estimate and pre-checks mirror the server rules for fast feedback,
 * but the Server Action re-validates everything — the server is the only source of truth.
 */
export function OrderTicket({
  quotes,
  cash,
  holdings,
  holdingsValue,
  execution,
  limits,
  defaultSymbol = "NVDA",
  quoteLabel = "the current quote",
}: OrderTicketProps) {
  const ids = useId();
  const [symbol, setSymbol] = useState(
    quotes.some((quote) => quote.symbol === defaultSymbol)
      ? defaultSymbol
      : (quotes[0]?.symbol ?? ""),
  );
  const [side, setSide] = useState<OrderSide>("BUY");
  const [quantityText, setQuantityText] = useState("10");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const quote = quotes.find((entry) => entry.symbol === symbol);
  const quantity = Number(quantityText);
  const held = holdings[symbol] ?? 0;

  const estimate = useMemo(() => {
    if (!quote || !Number.isFinite(quantity) || quantity <= 0) return null;
    const fillPrice = simulatedFillPrice(side, quote.price, execution);
    const notional = Math.round(fillPrice * quantity * 100) / 100;
    const fee = commissionFor(notional, execution);
    const cashImpact = side === "BUY" ? -(notional + fee) : notional - fee;
    const positionAfter = side === "BUY" ? held + quantity : held - quantity;
    const symbolValueAfter = Math.max(0, positionAfter) * quote.price;
    const totalAfter = cash + cashImpact + holdingsValue - held * quote.price + symbolValueAfter;
    return {
      fillPrice,
      notional,
      fee,
      cashImpact,
      cashAfter: cash + cashImpact,
      positionAfter,
      weightAfter: totalAfter > 0 ? symbolValueAfter / totalAfter : 0,
    };
  }, [quote, quantity, side, execution, held, cash, holdingsValue]);

  const problems: string[] = [];
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > limits.maxQuantity) {
    problems.push(
      `Quantity must be a whole number between 1 and ${limits.maxQuantity.toLocaleString("en-US")}.`,
    );
  } else if (estimate) {
    if (side === "BUY" && estimate.notional + estimate.fee > cash) {
      problems.push(
        `Insufficient virtual cash: needs ${formatCurrency(estimate.notional + estimate.fee)}, available ${formatCurrency(cash)}.`,
      );
    }
    if (side === "SELL" && quantity > held) {
      problems.push(`You hold ${held} ${symbol}; short selling is disabled.`);
    }
  }
  const concentrationWarning =
    side === "BUY" && estimate && estimate.weightAfter > limits.concentrationWarning
      ? `${symbol} would be ${formatPercent(estimate.weightAfter, 0)} of the portfolio.`
      : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await placePaperOrderAction({
        symbol,
        side,
        quantity,
        type: "MARKET",
        clientOrderId: crypto.randomUUID(),
      });
      const message = response.ok ? response.message : response.error;
      setResult({ ok: response.ok, message });
      if (response.ok) toast.success("Paper order filled", { description: message });
      else toast.error("Order not executed", { description: message });
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={`${ids}-disclaimer`}>
      <div className="space-y-2">
        <Label htmlFor={`${ids}-symbol`}>Symbol</Label>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger id={`${ids}-symbol`} className="w-full">
            <SelectValue placeholder="Select an asset" />
          </SelectTrigger>
          <SelectContent>
            {quotes.map((entry) => (
              <SelectItem key={entry.symbol} value={entry.symbol}>
                <span className="font-semibold">{entry.symbol}</span>
                <span className="text-muted-foreground">{formatCurrency(entry.price)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium" id={`${ids}-side-label`}>
          Side
        </span>
        <ToggleGroup
          type="single"
          value={side}
          onValueChange={(value) => value && setSide(value as OrderSide)}
          aria-labelledby={`${ids}-side-label`}
          className="grid w-full grid-cols-2"
        >
          <ToggleGroupItem value="BUY" className="h-8 data-[state=on]:text-positive">
            Buy
          </ToggleGroupItem>
          <ToggleGroupItem value="SELL" className="h-8 data-[state=on]:text-negative">
            Sell
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${ids}-quantity`}>Quantity</Label>
        <Input
          id={`${ids}-quantity`}
          inputMode="numeric"
          type="number"
          min={1}
          step={1}
          max={limits.maxQuantity}
          value={quantityText}
          onChange={(event) => setQuantityText(event.target.value)}
          aria-invalid={problems.length > 0}
          aria-describedby={`${ids}-estimate`}
        />
        <p className="text-xs text-muted-foreground">
          Held: <span className="num font-medium text-foreground">{held}</span> · Cash:{" "}
          <span className="num font-medium text-foreground">{formatCurrency(cash)}</span>
        </p>
      </div>

      <dl id={`${ids}-estimate`} className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Order type</dt>
          <dd className="font-medium">Market (paper)</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Est. fill price</dt>
          <dd className="num">{estimate ? formatCurrency(estimate.fillPrice) : "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Notional</dt>
          <dd className="num">{estimate ? formatCurrency(estimate.notional) : "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Commission</dt>
          <dd className="num">{estimate ? formatCurrency(estimate.fee) : "—"}</dd>
        </div>
        <div className="flex justify-between border-t pt-1.5 font-medium">
          <dt>{side === "BUY" ? "Total cost" : "Net proceeds"}</dt>
          <dd className="num">{estimate ? formatCurrency(Math.abs(estimate.cashImpact)) : "—"}</dd>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <dt>Cash after</dt>
          <dd className="num">{estimate ? formatCurrency(estimate.cashAfter) : "—"}</dd>
        </div>
      </dl>

      {(problems.length > 0 || concentrationWarning) && (
        <ul className="space-y-1 text-xs" aria-live="polite">
          {problems.map((problem) => (
            <li key={problem} className="flex gap-1.5 text-negative">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {problem}
            </li>
          ))}
          {concentrationWarning && (
            <li className="flex gap-1.5 text-status-warning-text">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Concentration:{" "}
              {concentrationWarning}
            </li>
          )}
        </ul>
      )}

      <Button
        type="submit"
        className={cn(
          "w-full",
          side === "SELL" && "bg-foreground text-background hover:bg-foreground/90",
        )}
        disabled={pending || !quote}
      >
        {pending && <LoaderCircle className="animate-spin" aria-hidden />}
        Place paper {side === "BUY" ? "buy" : "sell"} order
      </Button>

      <p
        role="status"
        aria-live="polite"
        className={cn(
          "min-h-4 text-xs",
          result ? (result.ok ? "text-positive" : "text-negative") : "",
        )}
      >
        {result?.message}
      </p>
      <p id={`${ids}-disclaimer`} className="text-[11px] leading-relaxed text-muted-foreground">
        Simulated execution: fills at {quoteLabel} ± {execution.slippageBps} bps slippage,
        commission {execution.commissionBps} bps (min {formatCurrency(execution.minimumCommission)}
        ). No real money, no broker connection. Orders the server rejects are still recorded with
        the reason.
      </p>
    </form>
  );
}
