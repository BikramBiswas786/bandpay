// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice SaucerSwap getAmountsOut stand-in. USDC is 6 decimals, so price8 * amountIn / 1e10 is the quote.
contract MockRouter {
    uint256 public price8;

    constructor(uint256 price8_) {
        price8 = price8_;
    }

    function set(uint256 price8_) external {
        price8 = price8_;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata) external view returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = (price8 * amountIn) / 1e10;
    }
}
