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
| The wait-for-expiry schedule | Someone has to send `release` at the right time. That is a keeper. |
| Chainlink and Supra | There is no price, so `release` cannot pay. |
| The band | A payment would clear at any price. |

## 15 minutes

Node 20.18.3 or newer.

```bash
npm install
npm test
npm run dev
```

`npm test` compiles the contract and runs seven cases: both feeds agree, Chainlink stale, the feeds disagree, both stale, outside the band then cancel, a stranger and an early call, and an ERC-20 stand-in for an HTS token. The Next page at `http://localhost:3000` applies the same rule so you can watch a revert before you touch a key.

## Testnet

Testnet feeds, not secrets:

| Feed | Address |
| --- | --- |
| Chainlink HBAR/USD | `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` |
| Supra push oracle, pair 75 | `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917` |

`BandPay` is already deployed with those addresses, pair id `75`, and a max age of `3600` seconds: [0.0.10820921](https://hashscan.io/testnet/contract/0.0.10820921).

| What happened | Proof |
| --- | --- |
| Contract created | [deploy](https://hashscan.io/testnet/transaction/0xd613652f5b29cdcc0c5eaf144956800c7fb7b706cf5927c66ff4e27340f5e002) |
| Payer called `release` while both feeds were fresh and inside the band. 0.1 HBAR was paid. | [release](https://hashscan.io/testnet/transaction/0xbced1142081f0b901f09aa4637dc18a2b298bcef44215eb4e749f183cb51749f) |
| A second 0.1 HBAR was escrowed, then a wait-for-expiry schedule called `release`. Hedera executed it. The plan is paid. | [schedule 0.0.10820928](https://hashscan.io/testnet/schedule/0.0.10820928) · [executed call](https://hashscan.io/testnet/transaction/0.0.10015230-1790921501-362680160) · [mirror](https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.10820928) |

To schedule another one, deploy your own copy or reuse `0.0.10820921` only if you are the payer `0.0.10015230`. Fund with `fundHbar` or `fundToken`. The token must be movable with `transfer` and `transferFrom`. An HTS token needs its ERC-20 facade, and the contract must be associated first. Put the key in the shell, not in a file you commit.

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
