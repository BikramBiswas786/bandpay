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
});
