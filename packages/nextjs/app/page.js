"use client";

import { useEffect, useMemo, useState } from "react";
import { decide } from "../lib/decide";
import { labScenarios } from "../lib/lab";
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
  const [activity, setActivity] = useState([]);
  const [mine, setMine] = useState([]);
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

  const scenarios = useMemo(() => labScenarios(feeds), [feeds]);
  const dueSeconds = Math.max(0, Math.round(Number(minutes) || 0) * 60);
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
      note("Stopped", err instanceof Error ? err.message : "The wallet call failed.");
    } finally {
      setBusy("");
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("command");
    } catch {
      setCopied("copy-failed");
    }
  }

  return (
    <main className="wrap">
      <header className="bar">
        <div>
          <span className="mark">Bandpay</span>
          <span className="net">Hedera testnet</span>
        </div>
        <button
          type="button"
          className="primary"
          disabled={Boolean(busy)}
          onClick={() => run("connect", onConnect)}
        >
          {account ? `${shortAccount(account)} · ${balance || "…"} HBAR` : "Connect wallet"}
        </button>
      </header>

      <section className="hero">
        <div>
          <p className="kicker">Not a registry. A scheduled payment.</p>
          <h1>Pay only inside the band.</h1>
          <p className="lede">
            The lab below needs no key. It shows what release would do. Only the first case uses the
            live feeds. The others are simulations of the same rule. The wallet, further down, is
            optional.
          </p>
        </div>
        <article className="price-card">
          <span>HBAR / USD</span>
          <strong>{price ? price.toFixed(4) : "…"}</strong>
          <span>
            {gap === null ? "Waiting for both feeds." : `Chainlink and Supra differ by ${gap} bps.`}
          </span>
        </article>
      </section>

      <section className="section">
        <h2>Developer lab</h2>
        <p>
          No account and no signature. A live row is the testnet price. A simulation changes one
          input and runs the same rule as the contract. The band on an HTS token is still this
          HBAR/USD price. The token does not have its own oracle here.
        </p>
        <div className="lab">
          {scenarios.map((item) => (
            <article key={item.id} className="card">
              <p className={item.kind === "simulation" ? "tag sim" : "tag live"}>{item.kind}</p>
              <h2>{item.title}</h2>
              <p className={item.ok ? "verdict ok" : "verdict bad"}>{item.result}</p>
              <p className="meta">
                Test: {item.test}. Code: {item.where}.
              </p>
              <pre className="command">{item.command}</pre>
              <button type="button" onClick={() => copy(item.command)}>
                Copy
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>One schedule, one attempt</h2>
        <p>
          Hedera calls release once, when the schedule expires. If the feed is stale, the feeds
          disagree, or the price is outside the band, that call reverts and the HBAR stays in the
          contract. Cancel returns it. Or sign a new schedule for the same plan after the price is
          back inside the band. A deadline before executeAt never gets signed: schedule.mjs stops.
        </p>
        <div className="cards">
          <article className="card">
            <h2>Schedule paid</h2>
            <p>
              Hedera executed release. The plan was paid. Signed by 0.0.10015230. Do not reuse that
              account.
            </p>
            <a href="https://hashscan.io/testnet/schedule/0.0.10820928">0.0.10820928</a>
          </article>
          <article className="card">
            <h2>Schedule refused</h2>
            <p>Hedera called release. OutsideBand reverted. The escrow stayed until cancel.</p>
            <a href="https://hashscan.io/testnet/schedule/0.0.10830733">0.0.10830733</a>
          </article>
          <article className="card">
            <h2>HTS, not scheduled</h2>
            <p>Associate, fund, and cancel are on testnet. A scheduled token release is not.</p>
            <a href="https://hashscan.io/testnet/contract/0.0.10823213">0.0.10823213</a>
          </article>
        </div>
      </section>

      {mine.length ? (
        <section className="banner">
          <p>
            This wallet still has escrow in plan {mine.join(", ")}. The earlier refuse check left
            one of these open if the run stopped on a red signature.
          </p>
          <button type="button" disabled={Boolean(busy)} onClick={() => run("return", onReturn)}>
            {busy === "return" ? "Returning…" : "Return my escrow"}
          </button>
        </section>
      ) : null}

      <section className="cards">
        <article className="card">
          <h2>Pay</h2>
          <p>
            Escrow 0.1 HBAR between $0.05 and $0.20, then release it to this wallet. Both
            transactions succeed.
          </p>
          <button
            type="button"
            className="primary"
            disabled={Boolean(busy)}
            onClick={() => run("pay", onPay)}
          >
            {busy === "pay" ? "Waiting for signatures…" : "Run pay"}
          </button>
        </article>
        <article className="card">
          <h2>Refuse</h2>
          <p>
            Escrow between $1 and $2. The node must return OutsideBand. You get the HBAR back. No
            failed transaction.
          </p>
          <button type="button" disabled={Boolean(busy)} onClick={() => run("refuse", onRefuse)}>
            {busy === "refuse" ? "Waiting for signatures…" : "Run refuse"}
          </button>
        </article>
        <article className="card">
          <h2>Too early</h2>
          <p>
            Due in one hour. Release is blocked, then the escrow comes back. The blocked call is not
            broadcast.
          </p>
          <button type="button" disabled={Boolean(busy)} onClick={() => run("early", onEarly)}>
            {busy === "early" ? "Waiting for signatures…" : "Run too early"}
          </button>
        </article>
      </section>

      {activity.length ? (
        <section className="section">
          <h2>This session</h2>
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
        </section>
      ) : null}

      {error ? <p className="stale">{error}</p> : null}

      <section className="section">
        <h2>Your own band</h2>
        <p>
          This only escrows. It does not release. The wallet max fee can look larger than the HBAR
          Hedera actually charges.
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
        {decision ? (
          <p className={decision.ok ? "verdict ok" : "verdict bad"}>
            {decision.ok
              ? `At the due time, the current price would pay from ${decision.source} at ${decision.price.toFixed(4)} USD.`
              : `At the due time, release would revert. ${decision.detail}`}
          </p>
        ) : null}
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={Boolean(busy)}
            onClick={() => run("fund", onFund)}
          >
            {busy === "fund" ? "Waiting for the wallet…" : "Fund this band"}
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

      <details className="section">
        <summary>Schedule it from the shell instead</summary>
        <p>
          An EVM wallet cannot sign a Hedera schedule. That is the path where Hedera fires release
          with no bot. Do not reuse account 0.0.10015230.
        </p>
        <pre className="command">{command}</pre>
        <button type="button" onClick={() => copy(command)}>
          {copied === "command" ? "Copied" : "Copy the commands"}
        </button>
        {copied === "copy-failed" ? (
          <p className="stale">Copy failed. Select the block instead.</p>
        ) : null}
      </details>

      {desk?.schedules?.length ? (
        <section className="section">
          <h2>Already fired on testnet</h2>
          <div className="schedules">
            {desk.schedules.map((item) => (
              <article key={item.id} className="tile">
                <h2>
                  <a href={`https://hashscan.io/testnet/schedule/${item.id}`}>{item.id}</a>
                </h2>
                <p className={item.result === "SUCCESS" ? "fresh" : "stale"}>
                  {scheduleLine(item)}
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
