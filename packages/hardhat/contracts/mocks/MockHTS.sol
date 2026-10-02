// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stand-in for the Hedera token service precompile at 0x167.
contract MockHTS {
    function associateToken(address, address) external pure returns (int64) {
        return 22;
    }
}

contract MockHTSReject {
    function associateToken(address, address) external pure returns (int64) {
        return 23;
    }
}
