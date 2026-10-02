// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockSupra {
    uint256 public price;
    uint256 public time;
    uint256 public decimals_ = 8;

    constructor(uint256 price_) {
        price = price_;
        time = block.timestamp;
    }

    function set(uint256 price_, uint256 time_) external {
        price = price_;
        time = time_;
    }

    function getSvalue(uint256) external view returns (uint256, uint256, uint256, uint256) {
        return (1, decimals_, time, price);
    }
}
