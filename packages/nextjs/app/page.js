"use client";

import { useEffect, useMemo, useState } from "react";
import { decide } from "../lib/decide";
import {
  balanceOf,
  callAction,
  connect,
  encodeCancel,
  encodeRelease,
  formatHbar,
  fund,
  parseHbar,
  shortAccount,
} from "../lib/wallet";

const hour = 3600;

const LABELS = {
  paid: "Paid",
  "would-pay": "Would pay",
  "outside-band": "Outside band",
  cancelled: "Returned",
  "too-early": "Too early",
  disagree: "Disagree",
  "no-price": "No price",
  empty: "Empty",
};

export default function Page() {
  const [desk, setDesk] = useState(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [min, setMin] = useState("0.05");
  const [max, setMax] = useState("0.20");
  const [minutes, setMinutes] = useState("60");
  const [copied, setCopied] = useState("");
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("");
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch("/api/desk", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Desk read failed");
        if (!stop) {
          setDesk(body);
          setError("");
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "Desk read failed");
      }
    }
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [reload]);

  const feeds = desk?.feeds;
  const decision = useMemo(() => {
    if (!feeds?.chainlink || !feeds?.supra) return null;
    const chainlink = feeds.chainlink.fresh
      ? { price: feeds.chainlink.price, ageSec: feeds.chainlink.ageSec, staleAfterSec: hour }
      : null;
    const supra = feeds.supra.fresh
      ? { price: feeds.supra.price, ageSec: feeds.supra.ageSec, staleAfterSec: hour }
      : null;
    return decide({ chainlink, supra, minPrice: Number(min), maxPrice: Number(max) });
  }, [feeds, min, max]);

  const dueSeconds = Math.max(0, Math.round(Number(minutes) || 0) * 60);
  const command = commandFor({
    amount,
    min,
    max,
    dueSeconds,
    allowRevert: decision && !decision.ok,
  });

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied("copy-failed");
    }
  }

  function push(line) {
    setLog((prev) => [...prev, `${prev.length + 1}. ${line}`]);
  }

  function injected() {
    if (typeof window === "undefined") return null;
    return window.ethereum || null;
  }

  async function remember(address) {
    setAccount(address);
    const wei = await balanceOf(injected(), address);
    setBalance(formatHbar(wei));
  }

  async function onConnect() {
    const eth = injected();
    if (!eth) {
      throw new Error(
        "No wallet in this browser. Install MetaMask or HashPack and open the page there.",
      );
    }
    const address = await connect(eth);
    await remember(address);
    push(`Connected ${shortAccount(address)} on Hedera testnet.`);
  }

  async function onFund() {
    const result = await fund(injected(), {
      from: account,
      amount,
      minUsd: min,
      maxUsd: max,
      dueSeconds,
    });
    push(`Funded plan ${result.planId}. ${result.hash}`);
    setReload((value) => value + 1);
    await remember(account);
  }

  async function onChecks() {
    const eth = injected();
    const wei = await balanceOf(eth, account);
    if (wei < parseHbar("0.15")) {
      throw new Error(
        `Balance is ${formatHbar(wei)} HBAR. Each check escrows 0.1 and returns it. Use the faucet if this is short.`,
      );
    }
    push("Pay check: fund 0.1 HBAR inside 0.05-0.20, due now.");
    const paid = await fund(eth, {
      from: account,
      amount: "0.1",
      minUsd: "0.05",
      maxUsd: "0.20",
      dueSeconds: 0,
    });
    push(`Plan ${paid.planId} funded. Releasing.`);
    const released = await callAction(eth, account, encodeRelease(paid.planId));
    if (released.reason === "rejected") throw new Error("You rejected the signature. Stopped.");
    if (!released.ok) {
      await callAction(eth, account, encodeCancel(paid.planId));
      throw new Error(`Pay check did not pay (${released.reason}). The escrow was cancelled.`);
    }
    push("Pay check passed.");

    push("Refuse check: fund 0.1 HBAR inside 1-2.");
    const refused = await fund(eth, {
      from: account,
      amount: "0.1",
      minUsd: "1",
      maxUsd: "2",
      dueSeconds: 0,
    });
    const refuseRelease = await callAction(eth, account, encodeRelease(refused.planId));
    if (refuseRelease.reason === "rejected") {
      throw new Error("You rejected the signature. That plan is still escrowed.");
    }
    if (refuseRelease.ok) throw new Error("Refuse check paid. The band should have reverted.");
    const refuseCancel = await callAction(eth, account, encodeCancel(refused.planId));
    if (!refuseCancel.ok) {
      throw new Error(`Release reverted (${refuseRelease.reason}) but cancel failed.`);
    }
    push(`Refuse check passed. Release returned ${refuseRelease.reason}. Escrow cancelled.`);

    push("Too-early check: due in one hour.");
    const early = await fund(eth, {
      from: account,
      amount: "0.1",
      minUsd: "0.05",
      maxUsd: "0.20",
      dueSeconds: 3600,
    });
    const earlyRelease = await callAction(eth, account, encodeRelease(early.planId));
    if (earlyRelease.reason === "rejected") {
      throw new Error("You rejected the signature. That plan is still escrowed.");
    }
    if (earlyRelease.ok) throw new Error("Too-early check paid. It should have reverted.");
    const earlyCancel = await callAction(eth, account, encodeCancel(early.planId));
    if (!earlyCancel.ok) {
      throw new Error(`Release reverted (${earlyRelease.reason}) but cancel failed.`);
    }
    push(`Too-early check passed. Release returned ${earlyRelease.reason}. Escrow cancelled.`);
    push("Done. Three checks ran from the wallet.");
    setReload((value) => value + 1);
    await remember(account);
  }

  async function run(label, task) {
    setBusy(label);
    try {
      await task();
    } catch (err) {
      push(err instanceof Error ? err.message : "The wallet call failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="wrap">
      <header className="top">
        <p className="mark">Bandpay</p>
        <p className="quiet">
          {account
            ? `${shortAccount(account)} · ${balance || "…"} HBAR`
            : "MetaMask or HashPack. The page never sees the key."}
        </p>
      </header>

      <p className="kicker">Not a registry. A scheduled payment.</p>
      <h1>Set the payment. See if it clears.</h1>
      <p className="lede">
        Same shape as a check you can run before you sign. The band is judged against the live
        Chainlink and Supra feeds. Hedera fires <code>release</code> later. The key stays in your
        shell.
      </p>

      <section className="work">
        <form
          className="tile"
          onSubmit={(event) => {
            event.preventDefault();
            copy(command, "command");
          }}
        >
          <h2>1. The payment</h2>
          <div className="grid-2 gap">
            <label>
              Amount, HBAR
              <input
                value={amount}
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label>
              Due in minutes
              <input
                value={minutes}
                inputMode="numeric"
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
          </div>
          <div className="grid-2 gap">
            <label>
              Min USD
              <input
                value={min}
                inputMode="decimal"
                onChange={(event) => setMin(event.target.value)}
              />
            </label>
            <label>
              Max USD
              <input
                value={max}
                inputMode="decimal"
                onChange={(event) => setMax(event.target.value)}
              />
            </label>
          </div>
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setMin("0.05");
                setMax("0.20");
              }}
            >
              Band that pays
            </button>
            <button
              type="button"
              onClick={() => {
                setMin("1");
                setMax("2");
              }}
            >
              Band that refuses
            </button>
          </div>
        </form>

        <article className="tile">
          <h2>2. What release would do</h2>
          {!decision ? <p className="quiet">Reading the two feeds…</p> : null}
          {decision ? (
            <p className={decision.ok ? "verdict ok" : "verdict bad"}>
              {dueSeconds > 0
                ? "If Hedera called release this second, it would be too early and the escrow would stay. "
                : ""}
              {decision.ok
                ? `At the due time, the current price would pay ${amount || "0"} HBAR from ${decision.source} at ${decision.price.toFixed(6)} USD.`
                : `At the due time, the current price would revert. ${decision.detail} The escrow would stay.`}
            </p>
          ) : null}
          <div className="steps">
            <div className="step">
              <b>1</b>
              <span>Escrow {amount || "0"} HBAR. Only the payer can release or cancel.</span>
            </div>
            <div className="step">
              <b>2</b>
              <span>
                Sign one wait-for-expiry schedule. It refuses a deadline before the due time
                {decision && !decision.ok ? ", and it refuses this band unless ALLOW_REVERT=1" : ""}
                .
              </span>
            </div>
            <div className="step">
              <b>3</b>
              <span>Hedera calls release. There is no bot.</span>
            </div>
            <div className="step">
              <b>4</b>
              <span>
                {decision?.ok
                  ? "The band contains the price, so the recipient is paid."
                  : "The band refuses the price, so the call reverts and the escrow stays."}
              </span>
            </div>
          </div>
        </article>
      </section>

      <section className="section">
        <h2>3. Sign the checks</h2>
        <p>
          Connect on Hedera testnet. The three checks fund 0.1 HBAR on{" "}
          <a href="https://hashscan.io/testnet/contract/0.0.10820921">0.0.10820921</a>, call{" "}
          <code>release</code>, and cancel anything that does not pay you back. You need a little
          testnet HBAR from the <a href="https://portal.hedera.com/faucet">faucet</a>. An EVM wallet
          cannot sign a schedule, so that path stays in the shell.
        </p>
        <div className="actions">
          {!account ? (
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy)}
              onClick={() => run("connect", onConnect)}
            >
              {busy === "connect" ? "Waiting for the wallet…" : "Connect wallet"}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy)}
              onClick={() => run("checks", () => onChecks())}
            >
              {busy === "checks" ? "Waiting for signatures…" : "Run the three checks"}
            </button>
          )}
          <button
            type="button"
            disabled={!account || Boolean(busy)}
            onClick={() => run("fund", () => onFund())}
          >
            Fund this payment
          </button>
        </div>
        {account ? (
          <p className="meta">
            Fund this payment uses the amount and band above. It does not call release.
          </p>
        ) : null}
        {log.length ? (
          <ul className="log">
            {log.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="section">
        <h2>4. Or sign from the shell</h2>
        <p>
          The schedule is a Hedera transaction, not an EVM one. Copy this when you want Hedera to
          fire <code>release</code> with no bot.
        </p>
        <pre className="command">{command}</pre>
        <div className="actions">
          <button type="button" className="primary" onClick={() => copy(command, "command")}>
            {copied === "command" ? "Copied" : "Copy the commands"}
          </button>
        </div>
        {copied === "copy-failed" ? (
          <p className="stale">Copy failed. Select the block instead.</p>
        ) : null}
      </section>

      {error ? <p className="stale">{error}</p> : null}

      {desk?.schedules?.length ? (
        <section className="section">
          <h2>Already fired on testnet</h2>
          <p>These are not a simulation. Hedera executed both.</p>
          <div className="schedules">
            {desk.schedules.map((item) => (
              <article key={item.id} className="tile">
                <h2>
                  <a href={`https://hashscan.io/testnet/schedule/${item.id}`}>{item.id}</a>
                </h2>
                <p className={item.result === "SUCCESS" ? "fresh" : "stale"}>
                  {scheduleLine(item)}
                </p>
                <p className="meta">
                  <a href={`https://hashscan.io/testnet/transaction/${item.transactionId}`}>
                    {item.result || "pending"}
                  </a>
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {desk?.books?.map((book) => (
        <section key={book.id} className="section">
          <h2>
            <a href={`https://hashscan.io/testnet/contract/${book.id}`}>{book.id}</a>
          </h2>
          <p>{book.note}</p>
          {book.plans.map((plan) => (
            <article key={plan.id} className="plan">
              <strong>Plan {plan.id}</strong>
              <div>
                <div>{plan.amountLabel}</div>
                <p className="meta">
                  Band {money(plan.minPrice)}–{money(plan.maxPrice)} USD. {plan.release.detail}
                </p>
              </div>
              <span className={pillClass(plan.release.state)}>
                {LABELS[plan.release.state] || plan.release.state}
              </span>
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}

function commandFor({ amount, min, max, dueSeconds, allowRevert }) {
  const lines = [
    `export AMOUNT_HBAR=${amount || "0.1"}`,
    `export MIN_USD=${min || "0"}`,
    `export MAX_USD=${max || "0"}`,
    `export DUE_IN_SECONDS=${dueSeconds}`,
    "export BANDPAY_CONTRACT_ID=0.0.YOUR_CONTRACT",
    "node packages/hardhat/scripts/fund.js",
    "export PLAN_ID=0",
    `export DUE_IN_SECONDS=${dueSeconds + 30}`,
  ];
  if (allowRevert) lines.push("export ALLOW_REVERT=1");
  lines.push("npm run schedule --workspace=@bandpay/schedule");
  return lines.join("\n");
}

function scheduleLine(item) {
  if (!item.executed) return "Waiting for Hedera.";
  if (item.result === "SUCCESS") return "Hedera paid the escrow.";
  if (item.result === "CONTRACT_REVERT_EXECUTED") {
    return "Hedera called release. The band refused. The escrow stayed.";
  }
  return item.result || "Executed.";
}

function money(value) {
  if (!Number.isFinite(value)) return "0";
  if (value < 0.000001) return "0";
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(2);
}

function pillClass(state) {
  if (state === "paid" || state === "would-pay") return "pill ok";
  if (state === "outside-band" || state === "disagree" || state === "no-price") return "pill bad";
  return "pill";
}
