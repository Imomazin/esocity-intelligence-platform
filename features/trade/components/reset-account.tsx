"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { resetPaperAccountAction } from "@/features/trade/actions";

export function ResetAccountButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function reset(mode: "demo" | "cash") {
    startTransition(async () => {
      const result = await resetPaperAccountAction(mode);
      if (result.ok) {
        toast.success("Paper account reset", { description: result.message });
        setOpen(false);
      } else {
        toast.error("Reset failed", { description: result.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RotateCcw /> Reset account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset paper account?</DialogTitle>
          <DialogDescription>
            This replaces your paper order history. Choose the seeded demo portfolio, or start fresh
            with $100,000 of virtual cash. The reset is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="outline" disabled={pending} onClick={() => reset("cash")}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />} Cash only
          </Button>
          <Button disabled={pending} onClick={() => reset("demo")}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden />} Restore demo
            portfolio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
