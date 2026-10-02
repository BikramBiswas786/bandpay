"use client";

import { useMemo, useState } from "react";
import { decide } from "../lib/decide";

const hour = 3600;

export default function Page() {
  const [cl, setCl] = useState("0.103");
  const [clAge, setClAge] = useState("2");
  const [su, setSu] = useState("0.104");
  const [suAge, setSuAge] = useState("5");
  const [min, setMin] = useState("0.05");
  const [max, setMax] = useState("0.20");

  const decision = useMemo(
    () =>
      decide({
        chainlink: { price: Number(cl), ageSec: Number(clAge) * 60, staleAfterSec: hour },
        supra: { price: Number(su), ageSec: Number(suAge) * 60, staleAfterSec: hour },
        minPrice: Number(min),
        maxPrice: Number(max),
      }),
    [cl, clAge, su, suAge, min, max],
  );

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <p style={{ letterSpacing: "0.06em", textTransform: "uppercase", color: "#8c4e2a" }}>Bandpay</p>
      <h1>Pay only inside the band</h1>
      <p>
        Fund a plan, then sign one schedule with wait-for-expiry. Hedera calls <code>release</code> at that time.
        A stranger cannot call it. Cancel returns the escrow before it pays.
      </p>
      <label>
        Chainlink
        <input value={cl} onChange={event => setCl(event.target.value)} />
      </label>
      <label>
        Age in minutes
        <input value={clAge} onChange={event => setClAge(event.target.value)} />
      </label>
      <label>
        Supra
        <input value={su} onChange={event => setSu(event.target.value)} />
      </label>
      <label>
        Age in minutes
        <input value={suAge} onChange={event => setSuAge(event.target.value)} />
      </label>
      <label>
        Min
        <input value={min} onChange={event => setMin(event.target.value)} />
      </label>
      <label>
        Max
        <input value={max} onChange={event => setMax(event.target.value)} />
      </label>
      <p>{decision.ok ? `Would pay from ${decision.source} at ${decision.price}` : decision.detail}</p>
      <p>The Solidity tests are the authority. This page is the same rule, so you can see a revert before you schedule.</p>
    </main>
  );
}
