"use client";

import { useEffect, useMemo, useState } from "react";
import { decide } from "../lib/decide";

const hour = 3600;

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

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, lineHeight: 1.45 }}>
      <p
        style={{
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#8c4e2a",
          marginBottom: 8,
        }}
      >
        Bandpay
      </p>
      <h1 style={{ fontWeight: 500, fontSize: 40, margin: "0 0 12px" }}>
        Will this payment clear?
      </h1>
      <p style={{ marginTop: 0 }}>
        Live Chainlink and Supra, then the escrows already on testnet. Each row is what{" "}
        <code>release</code> would do if Hedera called it now. The schedule script will not sign a
        deadline before <code>executeAt</code>, and it will not sign when the live feeds already say{" "}
        <code>release</code> would revert, unless <code>ALLOW_REVERT=1</code>.
      </p>

      {error ? <p style={{ color: "#8d2f2f" }}>{error}</p> : null}
      {!desk && !error ? <p>Reading testnet…</p> : null}

      {feeds ? (
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Feed name="Chainlink" quote={feeds.chainlink} />
          <Feed name="Supra" quote={feeds.supra} />
        </section>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
        <label>
          Min USD
          <input value={min} onChange={(event) => setMin(event.target.value)} style={field} />
        </label>
        <label>
          Max USD
          <input value={max} onChange={(event) => setMax(event.target.value)} style={field} />
        </label>
      </div>
      {decision ? (
        <p style={{ padding: 12, background: "#fff", border: "1px solid #d9d0c2" }}>
          {decision.ok
            ? `A new plan with this band would pay from ${decision.source} at ${decision.price.toFixed(6)} USD.`
            : decision.detail}
        </p>
      ) : null}

      {desk?.schedules?.map((item) => (
        <p key={item.id}>
          Schedule <a href={`https://hashscan.io/testnet/schedule/${item.id}`}>{item.id}</a>{" "}
          {item.executed ? "was executed by Hedera." : "has not executed."}{" "}
          {item.result ? `Result ${item.result}.` : null}{" "}
          <a href={`https://hashscan.io/testnet/transaction/${item.transactionId}`}>transaction</a>
        </p>
      ))}

      {desk?.books?.map((book) => (
        <section key={book.id}>
          <h2 style={{ fontWeight: 500 }}>
            <a href={`https://hashscan.io/testnet/contract/${book.id}`}>{book.id}</a>
          </h2>
          <p style={{ marginTop: 0 }}>{book.note}</p>
          {book.plans.map((plan) => (
            <article
              key={plan.id}
              style={{
                border: "1px solid #d9d0c2",
                padding: 12,
                marginBottom: 8,
                background: "#fff",
              }}
            >
              <strong>
                Plan {plan.id}: {plan.amountLabel} → {plan.recipient.slice(0, 8)}…
              </strong>
              <p style={{ margin: "6px 0 0" }}>
                Band {plan.minPrice}–{plan.maxPrice}. {plan.release.detail}
              </p>
            </article>
          ))}
        </section>
      ))}

      <h2 style={{ fontWeight: 500 }}>Copy these, delete the page</h2>
      <ul>
        <li>
          <code>BandPay.sol</code> — escrow, band, HTS associate
        </li>
        <li>
          <code>schedule.mjs</code> — refuses an early deadline and a revert the feeds already see,
          then <code>waitForExpiry</code>
        </li>
        <li>
          <code>feeds.js</code> and <code>plans.js</code> — the reads the desk is making
        </li>
        <li>
          <code>decide.js</code> — the same gate as the contract
        </li>
      </ul>
    </main>
  );
}

const field = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: 8,
  font: "inherit",
  boxSizing: "border-box",
};

function Feed({ name, quote }) {
  if (!quote) return null;
  return (
    <article style={{ border: "1px solid #d9d0c2", padding: 12, background: "#fff" }}>
      <h2 style={{ margin: 0, fontWeight: 500 }}>{name}</h2>
      <p style={{ margin: "8px 0 0", fontSize: 28 }}>{quote.price.toFixed(6)}</p>
      <p style={{ margin: "4px 0 0", color: quote.fresh ? "#2a5c3a" : "#8d2f2f" }}>
        {quote.fresh ? `fresh, ${quote.ageSec}s old` : `stale, ${quote.ageSec}s old`}
      </p>
    </article>
  );
}
