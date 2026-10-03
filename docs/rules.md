# How a payment clears

A plan is an escrow with a band. Hedera calls `release` once, at a time you chose. The call pays or it reverts. It does not try again.

## State

| State | Who can move it | What is true after |
| --- | --- | --- |
| Open | The payer, by `fundHbar`, `fundHbarUsd`, `fundHbarInstallments`, or `fundToken` | The contract holds the funds. `release` reverts `TooEarly` until `executeAt`. |
| Paid | `release`, by the payer or by a schedule whose payer is that account | The recipient has the funds. A second call reverts `BadState`. |
| Returned | The payer, by `cancel` | The payer has the funds back. A schedule that then calls `release` reverts. |
| Refused | Hedera called `release` and the call reverted | The escrow is unchanged. Sign a new schedule for the same plan, or cancel. |

`release` is `only the payer`. A schedule created with the Schedule Service precompile at `0x16b` runs as that payer. A direct call from the same key also pays. The template does not delete the direct call.

## The gate

Both reads are the HBAR price. Chainlink is HBAR/USD. Supra pair 75 is HBAR/USDT, used only when Chainlink is missing or stale. The token in escrow is not priced.

| Check | Revert | The escrow |
| --- | --- | --- |
| The two fresh prices differ by more than 3% | `Disagree` | Stays |
| Neither feed is fresh | `NoPrice` | Stays |
| The price is outside the band | `OutsideBand` | Stays |
| A dollar invoice and the SaucerSwap quote differ by more than 3% | `PoolOff` | Stays |
| The dollar amount no longer fits in the escrow | `Underfunded` | Stays |
| The call is before `executeAt` | `TooEarly` | Stays |

An HBAR band does not ask SaucerSwap. A dollar invoice does. On testnet the public WHBAR/USDC pool is not a dollar, so a dollar invoice reverts `PoolOff` on purpose. Mainnet addresses for that pool are pinned. Nothing in this template is deployed on mainnet.

## What is not in the contract

| Thing | Where it lives |
| --- | --- |
| Creating the schedule | `scheduleRelease` on BandPay. Contract `0.0.10839717` created schedule `0.0.10839746`. The payer signed. Hedera paid plan 1. An unsigned schedule from the same contract, `0.0.10839720`, executed as `INVALID_PAYER_SIGNATURE` and paid nothing. `packages/schedule/schedule.mjs` is the same wait-for-expiry shape without the precompile. ScheduleProbe `0.0.10832802` is an earlier proof, not this bytecode. |
| The HCS receipt | `packages/schedule/receipt.mjs`, after the mirror shows a result. The contract cannot write the topic. |
| The decision a developer sees before signing | `packages/rules/decide.js`. The contract repeats it. The page does not get a vote. |

## What a developer should not claim

The units of an HTS payment are the payer's token. This template does not check that token's price. The desk does not hold a key. `npm run check` reads the public plans. It does not create a schedule.
