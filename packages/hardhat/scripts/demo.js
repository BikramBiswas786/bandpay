/**
 * The path a developer runs before creating a Hedera account.
 *
 *   npm run demo
 *
 * Deploys BandPay against mock feeds, pays one escrow, then shows the reverts.
 * ScheduleFailed is expected: a local chain has no Schedule Service.
 */
const { ethers } = require("hardhat");

const HOUR = 3600n;
const usd = (whole, frac = 0) => BigInt(whole) * 10n ** 8n + BigInt(frac);
const BAND = [usd(0, 5_000_000), usd(0, 20_000_000)];

function say(step, detail) {
  console.log(JSON.stringify({ step, ...detail }));
}

function revertName(error, band) {
  const data = error?.data || error?.error?.data;
  if (typeof data === "string" && data.startsWith("0x")) {
    try {
      return band.interface.parseError(data).name;
    } catch {
      /* fall through */
    }
  }
  const text = String(error?.shortMessage || error?.message || error);
  const named = text.match(/custom error '([^'(]+)/);
  return named ? named[1] : text.slice(0, 120);
}

async function expectRevert(band, call) {
  try {
    await call();
    return null;
  } catch (error) {
    return revertName(error, band);
  }
}

async function deploy(router, path) {
  const V3 = await ethers.getContractFactory("MockV3Aggregator");
  const Supra = await ethers.getContractFactory("MockSupra");
  const chainlink = await V3.deploy(8, usd(0, 10_000_000));
  const supra = await Supra.deploy(usd(0, 10_100_000));
  const Band = await ethers.getContractFactory("BandPay");
  const band = await Band.deploy(
    await chainlink.getAddress(),
    await supra.getAddress(),
    75,
    HOUR,
    router ? await router.getAddress() : ethers.ZeroAddress,
    path ? path[0] : ethers.ZeroAddress,
    path ? path[1] : ethers.ZeroAddress,
  );
  return { chainlink, supra, band };
}

async function main() {
  const [payer, recipient] = await ethers.getSigners();
  const { chainlink, supra, band } = await deploy(null, null);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const value = ethers.parseEther("0.1");

  await band.fundHbar(recipient.address, BAND[0], BAND[1], now, { value });
  await band.release(0);
  const paid = await band.plans(0);
  say("paid", {
    plan: 0,
    hbar: "0.1",
    recipient: recipient.address,
    paid: paid.paid,
  });

  await chainlink.set(usd(0, 40_000_000), now);
  await supra.set(usd(0, 40_000_000), now);
  await band.fundHbar(recipient.address, BAND[0], BAND[1], now, { value });
  const outside = await expectRevert(band, () => band.release.staticCall(1));
  if (outside !== "OutsideBand") throw new Error(`expected OutsideBand, got ${outside}`);
  await band.cancel(1);
  say("outside-band", { plan: 1, revert: outside, escrow: "returned to the payer" });

  await chainlink.set(usd(0, 10_000_000), now);
  await supra.set(usd(0, 14_000_000), now);
  await band.fundHbar(recipient.address, BAND[0], BAND[1], now, { value });
  const disagree = await expectRevert(band, () => band.release.staticCall(2));
  if (disagree !== "Disagree") throw new Error(`expected Disagree, got ${disagree}`);
  say("feeds-disagree", { plan: 2, revert: disagree, escrow: "still in the contract" });

  await chainlink.set(usd(0, 10_000_000), now - 7200);
  await supra.set(usd(0, 10_000_000), now - 7200);
  await band.fundHbar(recipient.address, BAND[0], BAND[1], now, { value });
  const noPrice = await expectRevert(band, () => band.release.staticCall(3));
  if (noPrice !== "NoPrice") throw new Error(`expected NoPrice, got ${noPrice}`);
  say("no-price", { plan: 3, revert: noPrice, escrow: "still in the contract" });

  const Router = await ethers.getContractFactory("MockRouter");
  const router = await Router.deploy(usd(0, 20_000_000));
  const pooled = await deploy(router, [recipient.address, payer.address]);
  const poolNow = (await ethers.provider.getBlock("latest")).timestamp;
  await pooled.band.fundHbarUsd(recipient.address, usd(0, 5_000_000), BAND[0], BAND[1], poolNow, {
    value: 100_000_000n,
  });
  const poolOff = await expectRevert(pooled.band, () => pooled.band.release.staticCall(0));
  if (poolOff !== "PoolOff") throw new Error(`expected PoolOff, got ${poolOff}`);
  say("pool-off", {
    revert: poolOff,
    oracle: "0.10",
    pool: "0.20",
    escrow: "still in the contract",
  });

  await chainlink.set(usd(0, 10_000_000), now);
  await supra.set(usd(0, 10_100_000), now);
  await band.fundHbar(recipient.address, BAND[0], BAND[1], now + 3600, { value });
  const scheduled = await expectRevert(band, () => band.scheduleRelease.staticCall(4));
  if (scheduled !== "ScheduleFailed") throw new Error(`expected ScheduleFailed, got ${scheduled}`);
  say("schedule", {
    plan: 4,
    revert: scheduled,
    why: "This chain has no Schedule Service. On testnet, Hedera fires release.",
    payer: payer.address,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
