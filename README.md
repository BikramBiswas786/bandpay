# Bandpay

Schedule one payment. Hedera fires it. It clears only inside your price band.

```bash
npx create-scaffold-hbar@latest -- my-pay --template BikramBiswas786/bandpay --solidity-framework hardhat --package-manager npm
cd my-pay
npm install
npm test
npm run check
npm run dev
```

This template allows only Hardhat. `--solidity-framework hardhat` keeps the scaffolder off Foundry when GitHub does not return `template.json` (an unauthenticated rate limit does that, and the fallback then looks for Foundry and exits).

There is no bot. You sign a schedule once. At the expiry time Hedera calls `release`. If the price is outside the band, or both oracles are stale, or they disagree by more than 3%, the call reverts and the escrow stays yours. Cancel before that and the escrow comes back.

A registry template stops at the credit. This one starts at the payment: an escrow, a time, and a band. The desk at [bandpay-two.vercel.app](https://bandpay-two.vercel.app) reads the live feeds and the plans already on the contracts, and says what `release` would do if Hedera called it now. Plan 2 is still open and would pay. Plan 3 was scheduled on purpose: Hedera called `release`, the call reverted, and the 0.1 HBAR is still escrowed. `schedule.mjs` will not sign a deadline before `executeAt`, and it will not sign when the live feeds already say the call would revert, unless `ALLOW_REVERT=1`.

## What breaks if you remove it

| Remove | What is left |
| --- | --- |
| The wait-for-expiry schedule | Someone has to send `release` at the right time. That is a keeper. The template no longer has a point. |
| Chainlink and Supra, or `feeds.js` | There is no price. `release` cannot pay, and the page cannot tell you why. |
| The 300 bps check | One bad feed can push a payment through. |
| `associate` before `fundToken` | Hedera rejects the token credit. The HTS path reverts on every fund. |
| The band | A payment would clear at any price. |

## What you copy

The page is the desk. These files are the template:

| File | Why you keep it |
| --- | --- |
| [`packages/hardhat/contracts/BandPay.sol`](packages/hardhat/contracts/BandPay.sol) | Escrow, the band, and the HTS associate call. Deleting the oracle reads makes `release` unable to pay. |
| [`packages/schedule/schedule.mjs`](packages/schedule/schedule.mjs) | One `ScheduleCreate` with `waitForExpiry`. It refuses a deadline before `executeAt`, and it refuses to sign when the live feeds already say `release` would revert, unless `ALLOW_REVERT=1`. |
| [`packages/nextjs/lib/feeds.js`](packages/nextjs/lib/feeds.js) | The two `eth_call`s. Supra's clock is milliseconds. Chainlink's is seconds. Both get scaled to 8 decimals. |
| [`packages/nextjs/lib/plans.js`](packages/nextjs/lib/plans.js) | Decodes `plans(id)` and says whether `release` would pay, revert, or fire too early. |
| [`packages/rules/decide.js`](packages/rules/decide.js) | The same gate as the contract, so you can see a revert before you sign. |
| [`packages/hardhat/scripts/deploy.js`](packages/hardhat/scripts/deploy.js) | Deploys against the public testnet feeds and prints the `0.0.x` id. The key stays in the shell. |
| [`packages/hardhat/scripts/fund.js`](packages/hardhat/scripts/fund.js) | Escrows 0.1 HBAR and prints the plan id. `MIN_USD` and `MAX_USD` narrow the band. Without this, there is nothing for the schedule to release. |

## 15 minutes

Node 20.18.3 or newer.

```bash
npm install
npm test
npm run check
npm run dev
```

`npm test` needs no key and no network. It compiles the contract and runs the price rule, the feed decoder, the plan decoder, and eight contract cases.

`npm run check` does use the network. It reads Chainlink, Supra, and the escrows already on testnet, and prints what `release` would do right now. No key. Set `BANDPAY_CONTRACT_ID` when you want your own deployment instead of the proof contracts.

`npm run dev` is that same check, in the browser, at `http://localhost:3000`.

## One payment, with a key

A brand-new account from the [Hedera portal](https://portal.hedera.com) must be ECDSA, on testnet, and hold HBAR. Put the key in the shell only.

```bash
export DEPLOYER_PRIVATE_KEY=0xYOUR_ECDSA_KEY
export HEDERA_OPERATOR_ID=0.0.YOUR_ACCOUNT
export HEDERA_OPERATOR_KEY=$DEPLOYER_PRIVATE_KEY
node packages/hardhat/scripts/deploy.js
```

The last line prints `contractId`. Then escrow 0.1 HBAR. The band is wide on purpose, so a fresh feed can pay. `DUE_IN_SECONDS` is when `release` becomes legal.

```bash
export BANDPAY_CONTRACT_ID=0.0.THE_CONTRACT_ID
export DUE_IN_SECONDS=120
node packages/hardhat/scripts/fund.js
export PLAN_ID=0
export DUE_IN_SECONDS=180
npm run schedule --workspace=@bandpay/schedule
npm run check
```

Leave `MIN_USD` and `MAX_USD` unset for that first payment. The default band is about `0` to `1000` USD, so a fresh feed can pay. Set them when you want the desk to show a refusal:

```bash
export MIN_USD=1
export MAX_USD=2
export DUE_IN_SECONDS=60
node packages/hardhat/scripts/fund.js
```

`fund.js` prints `planId`. The schedule must expire after `executeAt`. If it does not, `schedule.mjs` exits and signs nothing. It also exits when the live feeds say `release` would revert, unless you set `ALLOW_REVERT=1`. That flag is how the outside-band plan was scheduled on purpose: Hedera still calls `release`, the call reverts, and the escrow stays.

## HTS

`fundToken` moves the token with `transferFrom`. On Hedera that facade call reverts until the contract is associated to the token. Call `associate(tokenSolidityAddress)` once. It hits precompile `0x167` and accepts only response code 22. Then `approve` the contract from the treasury account and call `fundToken`. HBAR does not need this step.

## Testnet

Testnet feeds, not secrets:

| Feed | Address |
| --- | --- |
| Chainlink HBAR/USD | `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` |
| Supra push oracle, pair 75 | `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917` |

`BandPay` is deployed against those addresses, pair id `75`, and a max age of `3600` seconds.

The first deployment is the schedule proof. It pays HBAR and does not have `associate`: [0.0.10820921](https://hashscan.io/testnet/contract/0.0.10820921).

| What happened | Proof |
| --- | --- |
| Contract created | [deploy](https://hashscan.io/testnet/transaction/0xd613652f5b29cdcc0c5eaf144956800c7fb7b706cf5927c66ff4e27340f5e002) |
| Payer called `release` while both feeds were fresh and inside the band. 0.1 HBAR was paid. | [release](https://hashscan.io/testnet/transaction/0xbced1142081f0b901f09aa4637dc18a2b298bcef44215eb4e749f183cb51749f) |
| A second 0.1 HBAR was escrowed, then a wait-for-expiry schedule called `release`. Hedera executed it. The plan is paid. | [schedule 0.0.10820928](https://hashscan.io/testnet/schedule/0.0.10820928) · [executed call](https://hashscan.io/testnet/transaction/0.0.10015230-1790921501-362680160) · [mirror](https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.10820928) |

Two later escrows on that same contract are still open. The desk judges them against the live feeds. Neither has been scheduled.

| What happened | Proof |
| --- | --- |
| Plan 2 escrows 0.1 HBAR inside a wide band. After `executeAt`, `release` would pay. | [fund plan 2](https://hashscan.io/testnet/transaction/0xbc3b5e2db42ff355046452f45edb1377447d23686ae57771d52eeff53676f7bc) |
| Plan 3 escrows 0.1 HBAR inside a 1–2 USD band. Today's price is about 0.10, so `release` would revert and the escrow would stay. | [fund plan 3](https://hashscan.io/testnet/transaction/0x4baaa1c305fa5c5d01e948fe8544288ac337c746148c34de295b77d766199993) |
| Hedera fired that plan anyway (`ALLOW_REVERT=1`). The scheduled call reverted `OutsideBand` at 0.09903519 USD. Plan 3 is still escrowed, not paid. | [schedule 0.0.10830733](https://hashscan.io/testnet/schedule/0.0.10830733) · [executed call](https://hashscan.io/testnet/transaction/0.0.10015230-1790970685-448974693) · [revert](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xb052df49203e6a594a9cf3ca095de72c77677b7b57efbdd6fd04d76a9bcae950) |

The current deployment adds `associate`. HTS token [0.0.10823214](https://hashscan.io/testnet/token/0.0.10823214) was associated, escrowed, and returned: [0.0.10823213](https://hashscan.io/testnet/contract/0.0.10823213).

| What happened | Proof |
| --- | --- |
| Contract created | [deploy](https://hashscan.io/testnet/transaction/0x167275253adeb8e6a3d0b0bef7b4bab2dd176792b2f30fbc91bfd77040dd53ff) |
| `associate` of `BAND` through precompile `0x167` | [associate](https://hashscan.io/testnet/transaction/0xaa56e37772c35c38dbe25cdd59b69bb3643c4e8d112e999c1ba7d3c241dc251a) |
| `fundToken` moved 5 units into the contract | [fund](https://hashscan.io/testnet/transaction/0xd22946f8cda8ba2f88e8fdd23403386b184b89cc8bf1c0578e615ed0c3182b8a) |
| `cancel` sent those 5 units back to the payer | [cancel](https://hashscan.io/testnet/transaction/0x47b23d519e5de3b0b8f391dea8115ac4f9df92fbbf1e2c1cddab057ebafebda2) |

To schedule another one, deploy your own copy with the commands above. Reuse `0.0.10820921` only if you are the payer `0.0.10015230`. Do not commit the key.

The script sets `waitForExpiry`, so the signed schedule waits until the expiration and then Hedera sends it. The admin key can delete that schedule before then.

## License

MIT. See [LICENSE](LICENSE).
