"use client";

import { useEffect, useMemo, useState } from "react";
import { decide } from "../lib/decide";
import { labScenarios } from "../lib/lab";
import { bandError } from "../lib/band";
import {
  balanceOf,
  callAction,
  connect,
  encodeCancel,
  encodeRelease,
  formatHbar,
  fund,
  openPlans,
  parseHbar,
  shortAccount,
  simulate,
  decodeRevert,
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
  "pool-off": "Pool off",
  "band-only": "Band only",
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
  const [activity, setActivity] = useState([]);
  const [mine, setMine] = useState([]);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState("schedule");
  const [picked, setPicked] = useState("fresh");

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

  const scenarios = useMemo(() => labScenarios(feeds), [feeds]);
  const dueSeconds = Math.max(0, Math.round(Number(minutes) || 0) * 60);
  const formError = bandError({ amount, minutes, min, max });
  const command = commandFor({
    amount,
    min,
    max,
    dueSeconds,
    allowRevert: decision && !decision.ok,
  });
  const price = feeds?.chainlink?.fresh ? feeds.chainlink.price : feeds?.supra?.price;
  const gap =
    feeds?.chainlink?.fresh && feeds?.supra?.fresh && feeds.chainlink.price > 0
      ? Math.floor(
          (Math.abs(feeds.chainlink.price - feeds.supra.price) * 10000) / feeds.chainlink.price,
        )
      : null;

  function note(title, detail, href) {
    setActivity((prev) =>
      [{ title, detail, href, key: `${prev.length}-${title}` }, ...prev].slice(0, 8),
    );
  }

  function injected() {
    if (typeof window === "undefined") return null;
    return window.ethereum || null;
  }

  async function remember(address) {
    const eth = injected();
    setAccount(address);
    if (!eth) return;
    setBalance(formatHbar(await balanceOf(eth, address)));
    setMine(await openPlans(eth, address));
  }

  async function ensure() {
    const eth = injected();
    if (!eth) {
      throw new Error(
        "No wallet in this browser. Install MetaMask or HashPack and open the desk there.",
      );
    }
    const address = account || (await connect(eth));
    await remember(address);
    const wei = await balanceOf(eth, address);
    if (wei < parseHbar("0.15")) {
      throw new Error(`Balance is ${formatHbar(wei)} HBAR. Use the faucet, then try again.`);
    }
    return { eth, address };
  }

  async function onPay() {
    const { eth, address } = await ensure();
    note("Pay", "Escrowing 0.1 HBAR inside $0.05–$0.20.");
    const paid = await fund(eth, {
      from: address,
      amount: "0.1",
      minUsd: "0.05",
      maxUsd: "0.20",
      dueSeconds: 0,
    });
    note("Funded", `Plan ${paid.planId} is in escrow.`, hashscan(paid.hash));
    const released = await callAction(eth, address, encodeRelease(paid.planId));
    if (!released.ok) {
      await callAction(eth, address, encodeCancel(paid.planId));
      throw new Error(`Release did not pay (${released.reason}). The escrow was returned.`);
    }
    note(
      "Paid",
      `Plan ${paid.planId} paid you. Hedera charged a small fee on top.`,
      hashscan(released.hash),
    );
    setReload((value) => value + 1);
    await remember(address);
  }

  async function onRefuse() {
    const { eth, address } = await ensure();
    note("Refuse", "Escrowing 0.1 HBAR inside $1–$2.");
    const refused = await fund(eth, {
      from: address,
      amount: "0.1",
      minUsd: "1",
      maxUsd: "2",
      dueSeconds: 0,
    });
    const sim = await simulate(eth, address, encodeRelease(refused.planId));
    if (sim.ok || sim.reason === "rejected") {
      await callAction(eth, address, encodeCancel(refused.planId));
      throw new Error(
        "The band would have paid. Escrow returned. Nothing was submitted as a failure.",
      );
    }
    const cancelled = await callAction(eth, address, encodeCancel(refused.planId));
    if (!cancelled.ok)
      throw new Error(`The node refused release (${sim.reason}) but the return failed.`);
    note(
      "Refused",
      `Release would revert with ${sim.reason}. That call was not sent, so the wallet stays green. Escrow returned.`,
      hashscan(cancelled.hash),
    );
    setReload((value) => value + 1);
    await remember(address);
  }

  async function onEarly() {
    const { eth, address } = await ensure();
    note("Too early", "Escrowing 0.1 HBAR that is not due for an hour.");
    const early = await fund(eth, {
      from: address,
      amount: "0.1",
      minUsd: "0.05",
      maxUsd: "0.20",
      dueSeconds: 3600,
    });
    const sim = await simulate(eth, address, encodeRelease(early.planId));
    if (sim.ok) {
      throw new Error(`Plan ${early.planId} is already due. Leave it, or return it below.`);
    }
    const cancelled = await callAction(eth, address, encodeCancel(early.planId));
    if (!cancelled.ok) throw new Error(`Release is blocked (${sim.reason}) but the return failed.`);
    note(
      "Too early",
      `Release would revert with ${sim.reason}. The failing call was not sent. Escrow returned.`,
      hashscan(cancelled.hash),
    );
    setReload((value) => value + 1);
    await remember(address);
  }

  async function onReturn() {
    const eth = injected();
    if (!eth || !account) throw new Error("Connect the wallet first.");
    const ids = await openPlans(eth, account);
    if (!ids.length) {
      note("Clear", "No open escrow on this contract for this wallet.");
      setMine([]);
      return;
    }
    for (const id of ids) {
      const result = await callAction(eth, account, encodeCancel(id));
      if (!result.ok) throw new Error(`Plan ${id} did not return (${result.reason}).`);
      note("Returned", `Plan ${id} sent the escrow back.`, hashscan(result.hash));
    }
    setReload((value) => value + 1);
    await remember(account);
  }

  async function onFund() {
    if (formError) throw new Error(formError);
    const { eth, address } = await ensure();
    const result = await fund(eth, {
      from: address,
      amount,
      minUsd: min,
      maxUsd: max,
      dueSeconds,
    });
    note(
      "Funded",
      `Plan ${result.planId} uses the band you set. It does not release.`,
      hashscan(result.hash),
    );
    setReload((value) => value + 1);
    await remember(address);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("view");
    if (next === "lab" || next === "chain" || next === "sign" || next === "schedule") setView(next);
    const scenario = params.get("case");
    if (scenario) setPicked(scenario);
  }, []);

  function openView(id) {
    setView(id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", id);
    window.history.replaceState(null, "", url);
  }

  async function onConnect() {
    const eth = injected();
    if (!eth) {
      throw new Error(
        "No wallet in this browser. Install MetaMask or HashPack and open the desk there.",
      );
    }
    const address = await connect(eth);
    await remember(address);
    note("Connected", `${shortAccount(address)} on Hedera testnet.`);
  }

  async function run(label, task) {
    setBusy(label);
    try {
      await task();
    } catch (err) {
      note("Stopped", decodeRevert(err));
    } finally {
      setBusy("");
    }
  }

  async function copy(text, key = "command") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied("copy-failed");
    }
  }

  const active = scenarios.find((item) => item.id === picked) || scenarios[0];

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <span className="mark">Bandpay</span>
          <span className="net">Testnet</span>
          <a className="repo" href="https://github.com/BikramBiswas786/bandpay">
            GitHub
          </a>
        </div>
        <div className="price-pill">
          <span>HBAR/USD</span>
          <strong>{price ? price.toFixed(4) : "…"}</strong>
          <span>{gap === null ? "feeds" : `${gap} bps`}</span>
        </div>
        <button
          type="button"
          className="primary"
          disabled={Boolean(busy)}
          onClick={() => run("connect", onConnect)}
        >
          {account ? `${shortAccount(account)} · ${balance || "…"}` : "Connect"}
        </button>
      </header>
      <p className="status" aria-live="polite">
        {activity[0]
          ? `${activity[0].title}. ${activity[0].detail}`
          : "No wallet. Hedera already ran the three outcomes."}
      </p>
      <div className="frame">
        <nav className="nav">
          {[
            ["lab", "Lab"],
            ["chain", "Chain"],
            ["sign", "Sign"],
            ["schedule", "Schedule"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={view === id ? "on" : ""}
              aria-pressed={view === id}
              onClick={() => openView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="stage">
          {view === "lab" && active ? (
            <div className="split">
              <ul className="menu">
                {scenarios.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.id === active.id ? "on" : ""}
                      aria-pressed={item.id === active.id}
                      onClick={() => {
                        setPicked(item.id);
                        const url = new URL(window.location.href);
                        url.searchParams.set("view", "lab");
                        url.searchParams.set("case", item.id);
                        window.history.replaceState(null, "", url);
                      }}
                    >
                      <i className={item.ok ? "dot ok" : "dot bad"} />
                      <span>{item.title}</span>
                      <small>{item.kind}</small>
                    </button>
                  </li>
                ))}
              </ul>
              <article className="detail">
                <p className={active.kind === "simulation" ? "tag sim" : "tag live"}>
                  {active.kind}
                </p>
                <h1>{active.title}</h1>
                <p className={active.ok ? "verdict ok" : "verdict bad"} aria-live="polite">
                  {active.result}
                </p>
                <p className="meta">
                  The band is the HBAR price, even when the escrow is an HTS token.
                </p>
                <dl className="facts">
                  <div>
                    <dt>Test</dt>
                    <dd>{active.test}</dd>
                  </div>
                  <div>
                    <dt>Code</dt>
                    <dd>{active.where}</dd>
                  </div>
                </dl>
                <pre className="command">{active.command}</pre>
                <button type="button" onClick={() => copy(active.command, active.id)}>
                  {copied === active.id ? "Copied" : "Copy command"}
                </button>
              </article>
            </div>
          ) : null}

          {view === "chain" ? (
            <section>
              <h1>What is on testnet</h1>
              <p className="lede">
                Read from the mirror and the two feeds. Nothing here is signed.
              </p>
              {error ? <p className="stale">{error}</p> : null}
              {desk?.books?.map((book) => (
                <div key={book.id}>
                  <h2>
                    <a href={`https://hashscan.io/testnet/contract/${book.id}`}>{book.id}</a>
                  </h2>
                  <table className="plans">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Escrow</th>
                        <th>Band</th>
                        <th>If released now</th>
                      </tr>
                    </thead>
                    <tbody>
                      {book.plans.map((plan) => (
                        <tr key={plan.id}>
                          <td>{plan.id}</td>
                          <td>{plan.amountLabel}</td>
                          <td>
                            {money(plan.minPrice)}–{money(plan.maxPrice)}
                          </td>
                          <td>
                            <span className={pillClass(plan.release.state)}>
                              {LABELS[plan.release.state] || plan.release.state}
                            </span>
                            <span className="meta"> {plan.release.detail}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          ) : null}

          {view === "sign" ? (
            <section>
              <h1>Sign a check</h1>
              <p className="lede">
                Optional. The lab does not need this. A check that should revert is asked of the
                node and not sent.
              </p>
              {mine.length ? (
                <div className="banner">
                  <p>Open escrow in plan {mine.join(", ")}.</p>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => run("return", onReturn)}
                  >
                    {busy === "return" ? "Returning…" : "Return escrow"}
                  </button>
                </div>
              ) : null}
              <div className="cards">
                <article className="card">
                  <h2>Pay</h2>
                  <p>0.1 HBAR, band $0.05–$0.20, then release.</p>
                  <button
                    type="button"
                    className="primary"
                    disabled={Boolean(busy)}
                    onClick={() => run("pay", onPay)}
                  >
                    {busy === "pay" ? "Waiting…" : "Run pay"}
                  </button>
                </article>
                <article className="card">
                  <h2>Refuse</h2>
                  <p>Band $1–$2. The node must return OutsideBand. No red transaction.</p>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => run("refuse", onRefuse)}
                  >
                    {busy === "refuse" ? "Waiting…" : "Run refuse"}
                  </button>
                </article>
                <article className="card">
                  <h2>Too early</h2>
                  <p>Due in an hour. The blocked release is not broadcast.</p>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => run("early", onEarly)}
                  >
                    {busy === "early" ? "Waiting…" : "Run too early"}
                  </button>
                </article>
              </div>
              {activity.length ? (
                <ul className="activity">
                  {activity.map((item) => (
                    <li key={item.key}>
                      <strong>{item.title}</strong>
                      <span>
                        {item.detail}{" "}
                        {item.href ? (
                          <a href={item.href} target="_blank" rel="noreferrer">
                            Hashscan
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <h2>Your own band</h2>
              <p className="meta">
                This only escrows. The wallet max fee can look larger than the charge.
              </p>
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
              {formError ? (
                <p className="verdict bad">{formError}</p>
              ) : decision ? (
                <p className={decision.ok ? "verdict ok" : "verdict bad"}>
                  {decision.ok
                    ? `Would pay from ${decision.source} at ${decision.price.toFixed(4)} USD.`
                    : `Would revert. ${decision.detail}`}
                </p>
              ) : null}
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(busy) || Boolean(formError)}
                  onClick={() => run("fund", onFund)}
                >
                  {busy === "fund" ? "Waiting…" : "Fund this band"}
                </button>
                <button
                  type="button"
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
            </section>
          ) : null}

          {view === "schedule" ? (
            <section>
              <h1>One attempt</h1>
              <p className="lede">
                Hedera calls release once. A revert leaves the escrow until cancel, or until a new
                schedule for the same plan. An EVM wallet cannot sign that schedule. Do not reuse
                0.0.10015230.
              </p>
              <pre className="command">{command}</pre>
              <button type="button" onClick={() => copy(command, "shell")}>
                {copied === "shell" ? "Copied" : "Copy the commands"}
              </button>
              {copied === "copy-failed" ? (
                <p className="stale">Copy failed. Select the block instead.</p>
              ) : null}
              <div className="cards">
                <article className="card">
                  <h2>Paid</h2>
                  <p>Hedera executed release.</p>
                  <a href="https://hashscan.io/testnet/schedule/0.0.10820928">0.0.10820928</a>
                </article>
                <article className="card">
                  <h2>Refused</h2>
                  <p>OutsideBand. The escrow stayed.</p>
                  <a href="https://hashscan.io/testnet/schedule/0.0.10830733">0.0.10830733</a>
                </article>
                <article className="card">
                  <h2>HTS</h2>
                  <p>Hedera paid 5 BAND. Plan 1 is paid.</p>
                  <a href="https://hashscan.io/testnet/schedule/0.0.10831792">0.0.10831792</a>
                </article>
                <article className="card">
                  <h2>Pool</h2>
                  <p>SaucerSwap was $2.25. The oracle was $0.10. PoolOff. The escrow stayed.</p>
                  <a href="https://hashscan.io/testnet/schedule/0.0.10832633">0.0.10832633</a>
                </article>
              </div>
              {desk?.topicId ? (
                <p className="meta">
                  HCS topic{" "}
                  <a href={`https://hashscan.io/testnet/topic/${desk.topicId}`}>{desk.topicId}</a>{" "}
                  repeats each of those results. The contract cannot write the topic itself.
                </p>
              ) : null}
              {desk?.receipts?.length ? (
                <ul className="activity">
                  {desk.receipts.map((item) => (
                    <li key={item.sequence}>
                      <strong>Message {item.sequence}</strong>
                      <span>
                        {item.result} · plan {item.planId} · {item.scheduleId}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {desk?.schedules?.length ? (
                <ul className="activity">
                  {desk.schedules.map((item) => (
                    <li key={item.id}>
                      <strong>
                        <a href={`https://hashscan.io/testnet/schedule/${item.id}`}>{item.id}</a>
                      </strong>
                      <span>{scheduleLine(item)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function hashscan(hash) {
  return hash ? `https://hashscan.io/testnet/transaction/${hash}` : "";
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
  if (item.id === "0.0.10830733") {
    return "Hedera called release. OutsideBand. The escrow stayed.";
  }
  if (item.id === "0.0.10832633") {
    return "Hedera called release. SaucerSwap was about $2.25 and the oracle was about $0.10. PoolOff. The escrow stayed.";
  }
  if (item.id === "0.0.10832843") {
    return "A contract created this schedule through the Schedule Service precompile. The payer signed it. Hedera paid plan 2.";
  }
  if (item.result === "SUCCESS") return "Hedera paid the escrow.";
  if (item.result === "CONTRACT_REVERT_EXECUTED") {
    return "Hedera called release. The call reverted and the escrow stayed.";
  }
  return item.result || "Executed.";
}

function money(value) {
  if (!Number.isFinite(value)) return "0.00";
  return value.toFixed(2);
}

function pillClass(state) {
  if (state === "paid" || state === "would-pay") return "pill ok";
  if (
    state === "outside-band" ||
    state === "disagree" ||
    state === "no-price" ||
    state === "pool-off"
  )
    return "pill bad";
  return "pill";
}
