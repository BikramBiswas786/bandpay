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
  const [min, setMin] = useState("0.05");
  const [max, setMax] = useState("0.20");

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

  const gap = useMemo(() => {
    if (!feeds?.chainlink?.fresh || !feeds?.supra?.fresh || feeds.chainlink.price <= 0) return null;
    return Math.floor(
      (Math.abs(feeds.chainlink.price - feeds.supra.price) * 10000) / feeds.chainlink.price,
    );
  }, [feeds]);

  return (
    <main className="wrap">
      <p className="kicker">Not a registry. A scheduled payment.</p>
      <h1>Pay only inside the band</h1>
      <p className="lede">
        Guardian already issues a credit. This template starts at the payment. You sign one
        schedule. Hedera calls <code>release</code>. The call pays only when Chainlink and Supra
        agree within 3% and the price is inside the band. Remove the schedule and someone has to run
        a bot. Remove either feed and nothing can pay.
      </p>

      {error ? <p className="stale">{error}</p> : null}
      {!desk && !error ? <p className="lede">Reading testnet…</p> : null}

      {feeds ? (
        <section className="grid-2">
          <Feed name="Chainlink" quote={feeds.chainlink} />
          <Feed name="Supra" quote={feeds.supra} />
        </section>
      ) : null}

      {gap !== null ? (
        <p className="meta">
          The two feeds differ by {gap} bps. The contract refuses anything over 300.
        </p>
      ) : null}

      <section className="section">
        <h2>Try a band against the live price</h2>
        <div className="grid-2 band-inputs">
          <label>
            Min USD
            <input
              value={min}
              onChange={(event) => setMin(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Max USD
            <input
              value={max}
              onChange={(event) => setMax(event.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        {decision ? (
          <p className={decision.ok ? "verdict ok" : "verdict bad"}>
            {decision.ok
              ? `A new escrow in this band would pay from ${decision.source} at ${decision.price.toFixed(6)} USD.`
              : decision.detail}
          </p>
        ) : null}
      </section>

      {desk?.schedules?.length ? (
        <section className="section">
          <h2>Hedera already fired both outcomes</h2>
          <p>No keeper. The same schedule service paid one escrow and reverted the other.</p>
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

      <section className="section">
        <h2>Copy these, delete the page</h2>
        <ul className="copy">
          <li>
            <code>BandPay.sol</code> — escrow, the band, and the HTS associate call
          </li>
          <li>
            <code>schedule.mjs</code> — one wait-for-expiry schedule. It refuses an early deadline
            and a revert the feeds already see.
          </li>
          <li>
            <code>feeds.js</code> and <code>plans.js</code> — the two oracle reads and the plan
            decoder this page uses
          </li>
          <li>
            <code>decide.js</code> — the same gate as the contract, before you sign
          </li>
        </ul>
      </section>
    </main>
  );
}

function scheduleLine(item) {
  if (!item.executed) return "Waiting for Hedera.";
  if (item.result === "SUCCESS") return "Hedera paid the escrow.";
  if (item.result === "CONTRACT_REVERT_EXECUTED")
    return "Hedera called release. The band refused. The escrow stayed.";
  return item.result || "Executed.";
}

function money(value) {
  if (!Number.isFinite(value)) return "–";
  if (value < 0.000001) return "0";
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(2);
}

function pillClass(state) {
  if (state === "paid" || state === "would-pay") return "pill ok";
  if (state === "outside-band" || state === "disagree" || state === "no-price") return "pill bad";
  return "pill";
}

function Feed({ name, quote }) {
  if (!quote) return null;
  return (
    <article className="tile">
      <h2>{name}</h2>
      <p className="price">{quote.price.toFixed(6)}</p>
      <p className={quote.fresh ? "fresh" : "stale"}>
        {quote.fresh ? `Fresh, ${quote.ageSec}s old` : `Stale, ${quote.ageSec}s old`}
      </p>
    </article>
  );
}
