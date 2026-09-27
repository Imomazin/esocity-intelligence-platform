import type { ReactNode } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Card with a consistent header (title, description, action) used across every module. */
export function SectionCard({
  title,
  description,
  action,
  footer,
  children,
  className,
  contentClassName,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  id?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)} id={id}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn("min-w-0", contentClassName)}>{children}</CardContent>
      {footer && (
        <CardFooter className="border-t text-xs text-muted-foreground">{footer}</CardFooter>
      )}
    </Card>
  );
}
