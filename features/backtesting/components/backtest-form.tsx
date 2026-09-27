"use client";

import { Play } from "lucide-react";
import Form from "next/form";

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

interface BacktestFormProps {
  symbols: { symbol: string; name: string }[];
  strategies: { id: string; name: string }[];
  values: {
    symbol: string;
    strategy: string;
    startDate: string;
    endDate: string;
    initialCapital: number;
    feeBps: number;
    slippageBps: number;
  };
  range: { min: string; max: string };
}

/**
 * GET form (next/form): parameters live in the URL, so every backtest is shareable and the page
 * works without JavaScript. Radix Selects submit through hidden native inputs via `name`.
 */
export function BacktestForm({ symbols, strategies, values, range }: BacktestFormProps) {
  return (
    <Form action="/backtesting" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      <div className="space-y-2 xl:col-span-2">
        <Label htmlFor="bt-symbol">Asset</Label>
        <Select name="symbol" defaultValue={values.symbol}>
          <SelectTrigger id="bt-symbol" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {symbols.map((entry) => (
              <SelectItem key={entry.symbol} value={entry.symbol}>
                <span className="font-semibold">{entry.symbol}</span>
                <span className="text-muted-foreground">{entry.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2 xl:col-span-2">
        <Label htmlFor="bt-strategy">Strategy</Label>
        <Select name="strategy" defaultValue={values.strategy}>
          <SelectTrigger id="bt-strategy" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {strategies.map((strategy) => (
              <SelectItem key={strategy.id} value={strategy.id}>
                {strategy.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="bt-start">Start date</Label>
        <Input
          id="bt-start"
          type="date"
          name="startDate"
          defaultValue={values.startDate}
          min={range.min}
          max={range.max}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bt-end">End date</Label>
        <Input
          id="bt-end"
          type="date"
          name="endDate"
          defaultValue={values.endDate}
          min={range.min}
          max={range.max}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bt-fee">Fee (bps)</Label>
        <Input
          id="bt-fee"
          type="number"
          name="feeBps"
          min={0}
          max={100}
          step={0.5}
          defaultValue={values.feeBps}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bt-slippage">Slippage (bps)</Label>
        <Input
          id="bt-slippage"
          type="number"
          name="slippageBps"
          min={0}
          max={100}
          step={0.5}
          defaultValue={values.slippageBps}
        />
      </div>
      <input type="hidden" name="initialCapital" value={values.initialCapital} />
      <div className="flex items-end sm:col-span-2 lg:col-span-4 xl:col-span-8">
        <Button type="submit">
          <Play /> Run backtest
        </Button>
        <p className="ml-3 text-xs text-muted-foreground">
          Starting capital ${values.initialCapital.toLocaleString("en-US")} · data available{" "}
          {range.min} → {range.max}
        </p>
      </div>
    </Form>
  );
}
