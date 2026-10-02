# Bandpay

One job. A payer escrows HBAR or an HTS facade token. A wait-for-expiry schedule calls `release`. The call pays only inside the price band.

## Rules

- `msg.sender` must be the payer. A stranger cannot release or cancel.
- Before `executeAt`, release reverts.
- Chainlink fresh and Supra fresh: they must agree within 300 bps, or the call reverts. Chainlink's price is the one compared to the band.
- One fresh source is enough. Chainlink first, then Supra.
- Neither fresh: revert. The escrow stays until `cancel`.
- Supra pair index is 75 (HBAR/USDT). Timestamps above 1e11 are treated as milliseconds. That conversion lives in the contract and in `packages/nextjs/lib/feeds.js`. Do not drop it.
- An HTS token must be associated on the contract (`associate`) before `fundToken`. The precompile is `0x167`. Success is response code 22.

## Do not

- Add a keeper, a fallback price, or a path that pays without a fresh source.
- Put an operator key in the repo.
- Turn this into a registry, a pool, or a second product.
- Replace the live `eth_call`s with a typed-in price. The page is there to show the feed read failing or clearing.

## Copy

Keep `BandPay.sol`, `packages/schedule/schedule.mjs`, `packages/nextjs/lib/feeds.js`, `packages/nextjs/lib/plans.js`, and `packages/rules/decide.js`. The Next page imports its own copy of `decide.js`; the test fails if the two files differ. `npm run check` is the same read as the page. `fund.js` opens an escrow. `MIN_USD` and `MAX_USD` narrow the band; the defaults stay wide. Do not skip the `executeAt` guard in the schedule script.

## Commands

```bash
npm test
npm run dev
```

Schedule, after deploy, with env vars set in the shell only:

```bash
npm run schedule --workspace=@bandpay/schedule
```
