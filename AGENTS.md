# Bandpay

One job. A payer escrows HBAR or an HTS facade token. A wait-for-expiry schedule calls `release`. The call pays only inside the price band.

## Rules

- `msg.sender` must be the payer. A stranger cannot release or cancel.
- Before `executeAt`, release reverts.
- Chainlink fresh and Supra fresh: they must agree within 300 bps, or the call reverts. Chainlink's price is the one compared to the band.
- A dollar invoice also calls SaucerSwap `getAmountsOut`. If that pool is more than 300 bps off the oracle, release reverts `PoolOff`. With no router it reverts `NoPool`. An HBAR payment that is not a dollar amount does not ask the pool. The testnet default is the public router `0.0.19264`, WHBAR `0.0.15058` and USDC `0.0.5449`. That pool prices HBAR near $2, so a testnet dollar invoice reverts `PoolOff`. Contract `0.0.10832627` is that proof. Do not point a testnet deploy at a self-priced pair.
- One fresh source is enough. Chainlink first, then Supra.
- Neither fresh: revert. The escrow stays until `cancel`.
- Supra pair index is 75 (HBAR/USDT). Timestamps above 1e11 are treated as milliseconds. That conversion lives in the contract and in `packages/nextjs/lib/feeds.js`. Do not drop it.
- An HTS token must be associated on the contract (`associate`) before `fundToken`. The precompile is `0x167`. Success is response code 22. The allowance is a Hedera `AccountAllowanceApproveTransaction`. An ERC-20 `approve` on the token facade reverts. `fund-token.js` does both, then `fundToken`.

## Do not

- Add a keeper, a fallback price, or a path that pays without a fresh source.
- Put an operator key in the repo.
- Turn this into a registry, a pool, or a second product.
- Replace the live `eth_call`s with a typed-in price. The page is there to show the feed read failing or clearing. Those calls must stay `cache: "no-store"`. Next.js will otherwise reuse an old `nextId` and the desk will hide new escrows.

## Copy

Keep `BandPay.sol`, `packages/schedule/schedule.mjs`, `packages/nextjs/lib/feeds.js`, `packages/nextjs/lib/plans.js`, and `packages/rules/decide.js`. The Next page imports its own copy of `decide.js`; the test fails if the two files differ. `npm run check` is the same read as the page. `fund.js` opens an escrow. `MIN_USD` and `MAX_USD` narrow the band; the defaults stay wide. Do not skip the `executeAt` guard. Do not sign a schedule the live feeds already reject unless `ALLOW_REVERT=1`. The proof topic is `0.0.10832517` in `books.js`. `receipt.mjs` appends a message after a schedule has a mirror result. Do not put the submit key in the repo.

## Commands

```bash
npm run test
npm run lint
npm run dev
```

Schedule, after deploy, with env vars set in the shell only:

```bash
npm run schedule --workspace=@bandpay/schedule
```

## Files

| Path | What it owns |
| --- | --- |
| `packages/hardhat/contracts/BandPay.sol` | The escrow. `release` pays or reverts. `scheduleRelease` calls `0x16b`. |
| `packages/hardhat/test/BandPay.js` | The contract cases, including the local refusal when `0x16b` is missing. |
| `packages/rules/decide.js` | The price rule. The page keeps its own copy in `packages/nextjs/lib/decide.js`. The test fails if they differ. |
| `packages/rules/pool.js` | The SaucerSwap gap. Dollar invoices only. |
| `packages/nextjs/lib/feeds.js` | Chainlink and Supra decoding, including the Supra millisecond conversion. |
| `packages/nextjs/lib/plans.js` | What an open plan would do. `cache: "no-store"` stays. |
| `packages/nextjs/app/page.js` | The desk. It does not hold a key and it cannot sign a schedule. |
| `packages/schedule/schedule.mjs` | Signs one wait-for-expiry schedule per plan. Refuses a deadline before `executeAt`. |
| `packages/schedule/receipt.mjs` | Writes the mirror result to the topic after Hedera has one. The contract cannot write that topic. |
| `packages/nextjs/lib/books.js` | The public proof ids. Topic `0.0.10832517`. Do not point a testnet deploy at a self-priced pair. |

## Invariants

- The contract does not choose a price. Chainlink, then Supra, does. No fresh source means the escrow stays.
- Two fresh sources more than 300 bps apart do not pay.
- A dollar invoice that is more than 300 bps from SaucerSwap does not pay. An ordinary HBAR band does not ask the pool.
- `0x16b` creates the schedule. The payer signs it. Hedera calls `release`. A laptop has no Schedule Service, so the demo ends at `ScheduleFailed`.
- HTS uses `0x167` and a Hedera allowance. An ERC-20 `approve` on the facade is not that allowance.
- Do not add a keeper, a second product, or a key in the repo.
