## Summary

<!-- What changed and why. -->

## Validation

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] `cd services/ml-api && ruff check . && pytest` (if the ML service or a mirrored engine changed)
- [ ] `pnpm parity:fixtures` re-run if a mirrored engine changed

## Safety checklist

- [ ] No secrets, tokens or credentials committed (`pnpm check:secrets`)
- [ ] Predictions are presented as probabilities, never guarantees
- [ ] No real-money execution or wagering paths introduced
