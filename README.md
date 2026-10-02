# Bandpay

Schedule one payment. Hedera fires it. It clears only inside your price band.

```bash
npm create scaffold-hbar@latest -- --template BikramBiswas786/bandpay
cd bandpay
npm install
npm test
npm run dev
```

There is no bot. You sign a schedule once. At the expiry time Hedera calls `release`. If the price is outside the band, or both oracles are stale, or they disagree by more than 3%, the call reverts and the escrow stays yours. Cancel before that and the escrow comes back.

This is not a carbon registry and it does not use Guardian.

## What breaks if you remove it

| Remove | What is left |
| --- | --- |
| The wait-for-expiry schedule | Someone has to send `release` at the right time. That is a keeper. The template no longer has a point. |
| Chainlink and Supra, or `feeds.js` | There is no price. `release` cannot pay, and the page cannot tell you why. |
| The 300 bps check | One bad feed can push a payment through. |
| `associate` before `fundToken` | Hedera rejects the token credit. The HTS path reverts on every fund. |
| The band | A payment would clear at any price. |

## What you copy

The page is a desk. These four files are the template:

| File | Why you keep it |
| --- | --- |
| [`packages/hardhat/contracts/BandPay.sol`](packages/hardhat/contracts/BandPay.sol) | Escrow, the band, and the HTS associate call. Deleting the oracle reads makes `release` unable to pay. |
| [`packages/schedule/schedule.mjs`](packages/schedule/schedule.mjs) | One `ScheduleCreate` with `waitForExpiry`. Hedera is the sender. |
| [`packages/nextjs/lib/feeds.js`](packages/nextjs/lib/feeds.js) | The two `eth_call`s. Supra's clock is milliseconds. Chainlink's is seconds. Both get scaled to 8 decimals. |
| [`packages/rules/decide.js`](packages/rules/decide.js) | The same gate as the contract, so you can see a revert before you sign. |

## 15 minutes

Node 20.18.3 or newer.

```bash
npm install
npm test
npm run dev
```

`npm test` compiles the contract and runs the price rule, the feed decoder, and eight contract cases: both feeds agree, Chainlink stale, the feeds disagree, both stale, outside the band then cancel, a stranger and an early call, an ERC-20 stand-in for an HTS facade, and the HTS precompile associate (success code 22, any other code reverts).

`npm run dev` serves the desk at `http://localhost:3000`. It reads the public testnet RPC. There is no key in the browser.

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

The current deployment adds `associate`. HTS token [0.0.10823214](https://hashscan.io/testnet/token/0.0.10823214) was associated, escrowed, and returned: [0.0.10823213](https://hashscan.io/testnet/contract/0.0.10823213).

| What happened | Proof |
| --- | --- |
| Contract created | [deploy](https://hashscan.io/testnet/transaction/0x167275253adeb8e6a3d0b0bef7b4bab2dd176792b2f30fbc91bfd77040dd53ff) |
| `associate` of `BAND` through precompile `0x167` | [associate](https://hashscan.io/testnet/transaction/0xaa56e37772c35c38dbe25cdd59b69bb3643c4e8d112e999c1ba7d3c241dc251a) |
| `fundToken` moved 5 units into the contract | [fund](https://hashscan.io/testnet/transaction/0xd22946f8cda8ba2f88e8fdd23403386b184b89cc8bf1c0578e615ed0c3182b8a) |
| `cancel` sent those 5 units back to the payer | [cancel](https://hashscan.io/testnet/transaction/0x47b23d519e5de3b0b8f391dea8115ac4f9df92fbbf1e2c1cddab057ebafebda2) |

To schedule another one, deploy your own copy. Reuse `0.0.10820921` only if you are the payer `0.0.10015230`. Put the key in the shell, not in a file you commit.

```bash
export HEDERA_OPERATOR_ID=0.0.YOUR_ACCOUNT
export HEDERA_OPERATOR_KEY=0xYOUR_ECDSA_KEY
export BANDPAY_CONTRACT_ID=0.0.YOUR_CONTRACT
export PLAN_ID=0
export DUE_IN_SECONDS=3600
npm run schedule --workspace=@bandpay/schedule
```

The script sets `waitForExpiry`, so the signed schedule waits until the expiration and then Hedera sends it. The admin key can delete that schedule before then.

## License

MIT. See [LICENSE](LICENSE).
