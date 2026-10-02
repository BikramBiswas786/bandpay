const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  usd8,
  parseHbar,
  encodeFund,
  encodeRelease,
  encodeCancel,
  decodeRevert,
} = require("./wallet");

test("fund calldata matches ethers for a 0.05 to 0.20 band", () => {
  const data = encodeFund(
    "0x87aca0b7ad05e10f7ce953827d9a8b3a8231d9b2",
    usd8("0.05"),
    usd8("0.20"),
    1700000000,
  );
  assert.equal(
    data,
    "0x8790fbc900000000000000000000000087aca0b7ad05e10f7ce953827d9a8b3a8231d9b200000000000000000000000000000000000000000000000000000000004c4b400000000000000000000000000000000000000000000000000000000001312d00000000000000000000000000000000000000000000000000000000006553f100",
  );
});

test("0.1 HBAR is the 18-decimal value the relay turns into tinybar", () => {
  assert.equal(parseHbar("0.1"), 100_000_000_000_000_000n);
  assert.equal(usd8("1"), 100_000_000n);
});

test("release and cancel selectors stay stable", () => {
  assert.equal(encodeRelease(3), "0x37bdc99b" + "0".repeat(63) + "3");
  assert.equal(encodeCancel(4), "0x40e58ee5" + "0".repeat(63) + "4");
});

test("a revert payload names the band error", () => {
  assert.equal(decodeRevert({ data: "0x5fc7b305" }), "OutsideBand");
  assert.equal(decodeRevert({ code: 4001, message: "User rejected" }), "rejected");
});
