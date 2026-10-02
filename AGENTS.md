# Bandpay

One job. A payer escrows HBAR or an HTS facade token. A wait-for-expiry schedule calls `release`. The call pays only inside the price band.

## Rules

- `msg.sender` must be the payer. A stranger cannot release or cancel.
- Before `executeAt`, release reverts.
- Chainlink fresh and Supra fresh: they must agree within 300 bps, or the call reverts. Chainlink's price is the one compared to the band.
- One fresh source is enough. Chainlink first, then Supra.
- Neither fresh: revert. The escrow stays until `cancel`.
- Supra pair index is 75 (HBAR/USDT). Timestamps above 1e11 are treated as milliseconds.

## Do not

- Add a keeper, a fallback price, or a path that pays without a fresh source.
- Put an operator key in the repo.
- Turn this into a registry, a pool, or a second product.

## Commands

```bash
npm test
npm run dev
```

Schedule, after deploy, with env vars set in the shell only:

```bash
npm run schedule --workspace=@bandpay/schedule
```
