"use client";

import { useEffect, useMemo, useState } from "react";
import { decide } from "../lib/decide";

const hour = 3600;

export default function Page() {
  const [feeds, setFeeds] = useState(null);
  const [error, setError] = useState("");
  const [min, setMin] = useState("0.05");
  const [max, setMax] = useState("0.20");

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch("/api/price", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Price read failed");
        if (!stop) {
          setFeeds(body);
          setError("");
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "Price read failed");
      }
    }
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

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
      <p style={{ letterSpacing: "0.08em", textTransform: "uppercase", color: "#8c4e2a", marginBottom: 8 }}>Bandpay</p>
      <h1 style={{ fontWeight: 500, fontSize: 40, margin: "0 0 12px" }}>Pay only inside the band</h1>
      <p style={{ marginTop: 0 }}>
        These are the live testnet feeds, not typed-in numbers. Chainlink HBAR/USD and Supra pair 75. The same
        rule is in <code>BandPay.release</code>. Hedera calls that function from a wait-for-expiry schedule. A keeper
        is not part of the template.
      </p>

      {error ? <p style={{ color: "#8d2f2f" }}>{error}</p> : null}
      {!feeds && !error ? <p>Reading testnet…</p> : null}

      {feeds ? (
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Feed name="Chainlink" quote={feeds.chainlink} />
          <Feed name="Supra" quote={feeds.supra} />
        </section>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
        <label>
          Min USD
          <input value={min} onChange={event => setMin(event.target.value)} style={field} />
        </label>
        <label>
          Max USD
          <input value={max} onChange={event => setMax(event.target.value)} style={field} />
        </label>
      </div>

      {decision ? (
        <p style={{ padding: 12, background: "#fff", border: "1px solid #d9d0c2" }}>
          {decision.ok
            ? `A release now would pay from ${decision.source} at ${decision.price.toFixed(6)} USD.`
            : decision.detail}
        </p>
      ) : null}

      <h2 style={{ fontWeight: 500 }}>Copy these, delete the page</h2>
      <ul>
        <li><code>packages/hardhat/contracts/BandPay.sol</code> — escrow, band, HTS <code>associate</code></li>
        <li><code>packages/schedule/schedule.mjs</code> — one schedule, <code>waitForExpiry</code></li>
        <li><code>packages/nextjs/lib/feeds.js</code> — the two <code>eth_call</code>s, including Supra milliseconds</li>
        <li><code>packages/rules/decide.js</code> — the same gate, so a revert is visible before you sign</li>
      </ul>
      <p>
        Schedule proof, HBAR, Hedera executed it:{" "}
        <a href="https://hashscan.io/testnet/schedule/0.0.10820928">0.0.10820928</a>. HTS proof, associate then
        escrow then return, on <a href="https://hashscan.io/testnet/contract/0.0.10823213">0.0.10823213</a> and token{" "}
        <a href="https://hashscan.io/testnet/token/0.0.10823214">0.0.10823214</a>.
      </p>
    </main>
  );
}

const field = { display: "block", width: "100%", marginTop: 4, padding: 8, font: "inherit" };

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
