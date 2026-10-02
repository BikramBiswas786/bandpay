const { expect } = require("chai");
const { ethers } = require("hardhat");

const HOUR = 3600n;
const USD = (whole, frac = 0) => BigInt(whole) * 10n ** 8n + BigInt(frac);

async function setup() {
  const [payer, recipient, stranger] = await ethers.getSigners();
  const V3 = await ethers.getContractFactory("MockV3Aggregator");
  const Supra = await ethers.getContractFactory("MockSupra");
  const chainlink = await V3.deploy(8, USD(0, 10_000_000));
  const supra = await Supra.deploy(USD(0, 10_100_000));
  const Band = await ethers.getContractFactory("BandPay");
  const band = await Band.deploy(await chainlink.getAddress(), await supra.getAddress(), 75, HOUR);
  return { payer, recipient, stranger, chainlink, supra, band };
}

describe("BandPay", function () {
  it("pays HBAR when both feeds agree inside the band", async function () {
    const { payer, recipient, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
      value: ethers.parseEther("1"),
    });
    await expect(band.release(0)).to.changeEtherBalance(recipient, ethers.parseEther("1"));
  });

  it("uses Supra when Chainlink is stale", async function () {
    const { payer, recipient, chainlink, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await chainlink.set(USD(0, 10_000_000), now - 7200);
    await band
      .connect(payer)
      .fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
        value: ethers.parseEther("1"),
      });
    await expect(band.release(0)).to.changeEtherBalance(recipient, ethers.parseEther("1"));
  });

  it("reverts when the feeds disagree by more than 3%", async function () {
    const { recipient, supra, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await supra.set(USD(0, 14_000_000), now);
    await band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
      value: ethers.parseEther("1"),
    });
    await expect(band.release(0)).to.be.revertedWithCustomError(band, "Disagree");
  });

  it("reverts when both feeds are stale", async function () {
    const { recipient, chainlink, supra, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await chainlink.set(USD(0, 10_000_000), now - 7200);
    await supra.set(USD(0, 10_000_000), now - 7200);
    await band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
      value: ethers.parseEther("1"),
    });
    await expect(band.release(0)).to.be.revertedWithCustomError(band, "NoPrice");
  });

  it("reverts outside the band and then lets the payer cancel", async function () {
    const { payer, recipient, chainlink, supra, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await chainlink.set(USD(0, 40_000_000), now);
    await supra.set(USD(0, 40_000_000), now);
    await band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
      value: ethers.parseEther("1"),
    });
    await expect(band.release(0)).to.be.revertedWithCustomError(band, "OutsideBand");
    await expect(band.cancel(0)).to.changeEtherBalance(payer, ethers.parseEther("1"));
  });

  it("rejects a stranger and an early call", async function () {
    const { recipient, stranger, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now + 3600, {
      value: ethers.parseEther("1"),
    });
    await expect(band.connect(stranger).release(0)).to.be.revertedWithCustomError(band, "NotPayer");
    await expect(band.release(0)).to.be.revertedWithCustomError(band, "TooEarly");
  });

  it("pays an ERC-20 stand-in for an HTS facade token", async function () {
    const { payer, recipient, band } = await setup();
    const Token = await ethers.getContractFactory("MockToken");
    const token = await Token.deploy(payer.address, 50n);
    await token.approve(await band.getAddress(), 50n);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await band.fundToken(
      recipient.address,
      await token.getAddress(),
      50n,
      USD(0, 5_000_000),
      USD(0, 20_000_000),
      now,
    );
    await band.release(0);
    expect(await token.balanceOf(recipient.address)).to.equal(50n);
  });

  it("associates through the HTS precompile and reverts on any other code", async function () {
    const { band } = await setup();
    const Ok = await ethers.getContractFactory("MockHTS");
    const Bad = await ethers.getContractFactory("MockHTSReject");
    const ok = await Ok.deploy();
    const bad = await Bad.deploy();
    const token = ethers.Wallet.createRandom().address;
    await ethers.provider.send("hardhat_setCode", [
      "0x0000000000000000000000000000000000000167",
      await ethers.provider.getCode(await ok.getAddress()),
    ]);
    await band.associate(token);
    await ethers.provider.send("hardhat_setCode", [
      "0x0000000000000000000000000000000000000167",
      await ethers.provider.getCode(await bad.getAddress()),
    ]);
    await expect(band.associate(token)).to.be.revertedWithCustomError(band, "AssociateFailed");
  });

  it("emits Funded, Released, and Cancelled", async function () {
    const { payer, recipient, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await expect(
      band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
        value: ethers.parseEther("1"),
      }),
    )
      .to.emit(band, "Funded")
      .withArgs(
        0,
        payer.address,
        recipient.address,
        ethers.ZeroAddress,
        ethers.parseEther("1"),
        USD(0, 5_000_000),
        USD(0, 20_000_000),
        now,
        0,
      );
    await expect(band.release(0))
      .to.emit(band, "Released")
      .withArgs(0, USD(0, 10_000_000), ethers.parseEther("1"));
    await band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
      value: ethers.parseEther("1"),
    });
    await expect(band.cancel(1)).to.emit(band, "Cancelled").withArgs(1);
  });

  it("pays a USD amount of HBAR and refunds the rest of the escrow", async function () {
    const { recipient, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const before = await ethers.provider.getBalance(recipient.address);
    await band.fundHbarUsd(
      recipient.address,
      USD(0, 5_000_000),
      USD(0, 5_000_000),
      USD(0, 20_000_000),
      now,
      {
        value: 100_000_000n,
      },
    );
    await band.release(0);
    expect(await ethers.provider.getBalance(recipient.address)).to.equal(before + 50_000_000n);
    expect(await ethers.provider.getBalance(await band.getAddress())).to.equal(0n);
  });

  it("reverts a USD payout that no longer fits in the escrow", async function () {
    const { recipient, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await band.fundHbarUsd(recipient.address, USD(2), USD(0, 5_000_000), USD(0, 20_000_000), now, {
      value: 100_000_000n,
    });
    await expect(band.release(0)).to.be.revertedWithCustomError(band, "Underfunded");
  });

  it("splits one escrow into instalments", async function () {
    const { recipient, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await band.fundHbarInstallments(
      recipient.address,
      2,
      3600,
      USD(0, 5_000_000),
      USD(0, 20_000_000),
      now,
      {
        value: 200_000_000n,
      },
    );
    expect((await band.plans(0)).amount).to.equal(100_000_000n);
    expect((await band.plans(1)).amount).to.equal(100_000_000n);
    expect((await band.plans(1)).executeAt).to.equal(BigInt(now) + 3600n);
    await expect(band.release(1)).to.be.revertedWithCustomError(band, "TooEarly");
    expect((await band.plans(0)).amount + (await band.plans(1)).amount).to.equal(200_000_000n);
  });

  it("records a refusal without undoing the escrow", async function () {
    const { recipient, chainlink, supra, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await chainlink.set(USD(0, 40_000_000), now);
    await supra.set(USD(0, 40_000_000), now);
    await band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
      value: ethers.parseEther("1"),
    });
    await expect(band.attempt(0)).to.emit(band, "Attempted").withArgs(0, false);
    expect((await band.plans(0)).paid).to.equal(false);
    expect(await ethers.provider.getBalance(await band.getAddress())).to.equal(
      ethers.parseEther("1"),
    );
  });

  it("attempt pays when the band allows it", async function () {
    const { recipient, band } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await band.fundHbar(recipient.address, USD(0, 5_000_000), USD(0, 20_000_000), now, {
      value: ethers.parseEther("1"),
    });
    await expect(band.attempt(0)).to.emit(band, "Attempted").withArgs(0, true);
    expect((await band.plans(0)).paid).to.equal(true);
  });
});
