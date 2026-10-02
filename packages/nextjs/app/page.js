"use client";

import { useEffect, useMemo, useState } from "react";
import { decide } from "../lib/decide";

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
  }, []);

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

  return (
    <main className="wrap">
      <header className="top">
        <p className="mark">Bandpay</p>
        <p className="quiet">Testnet. This page never asks for a key.</p>
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
        <h2>3. Run it</h2>
        <p>The page cannot sign. Copy this. Put the key in the shell only, after you deploy.</p>
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
