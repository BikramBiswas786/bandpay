# Bandpay

Schedule one payment. Hedera fires it. It clears only inside your price band.

```bash
npm create scaffold-hbar@latest -- bandpay --template BikramBiswas786/bandpay
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

`npm test` compiles the contract and runs seven cases: agree, Chainlink stale, disagree, both stale, outside the band, stranger, too early, and an ERC-20 stand-in for an HTS token. The Next page at `http://localhost:3000` applies the same rule so you can watch a revert before you touch a key.

## Testnet

Testnet feeds, not secrets:

| Feed | Address |
| --- | --- |
| Chainlink HBAR/USD | `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` |
| Supra push oracle, pair 75 | `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917` |

Deploy `BandPay` with those addresses, pair id `75`, and a max age of `3600` seconds. Fund with `fundHbar` or `fundToken`. The token must be movable with `transfer` and `transferFrom`. An HTS token needs its ERC-20 facade, and the contract must be associated first.

Then schedule `release(id)`. Put the key in the shell, not in a file you commit.

```bash
export HEDERA_OPERATOR_ID=0.0.YOUR_ACCOUNT
export HEDERA_OPERATOR_KEY=0xYOUR_ECDSA_KEY
export BANDPAY_CONTRACT_ID=0.0.YOUR_CONTRACT
export PLAN_ID=0
export DUE_IN_SECONDS=3600
npm run schedule --workspace=@bandpay/schedule
```

The script sets `waitForExpiry`, so the signed schedule waits until the expiration and then Hedera sends it. The admin key can delete that schedule before then. The mirror-node link for the schedule id is the proof. This repo does not contain one yet: creating it spends testnet HBAR from your account.

## License

MIT. See [LICENSE](LICENSE).
