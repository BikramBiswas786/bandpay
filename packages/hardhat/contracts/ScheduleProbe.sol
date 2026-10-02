// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IHederaScheduleService {
    function scheduleCallWithPayer(
        address to,
        address payer,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress);
}

/// @dev One-shot probe. Not part of the payment. Deleted if the precompile does not schedule.
contract ScheduleProbe {
    address internal constant HSS = address(uint160(0x16b));
    int64 internal constant SUCCESS = 22;

    error ScheduleFailed(int64 code);

    function scheduleRelease(address band, address payer, uint256 expiry, uint256 planId)
        external
        returns (address schedule)
    {
        bytes memory callData = abi.encodeWithSignature("release(uint256)", planId);
        (bool ok, bytes memory data) = HSS.call(
            abi.encodeWithSelector(
                IHederaScheduleService.scheduleCallWithPayer.selector,
                band,
                payer,
                expiry,
                uint256(500_000),
                uint64(0),
                callData
            )
        );
        if (!ok || data.length < 64) revert ScheduleFailed(-1);
        int64 code;
        (code, schedule) = abi.decode(data, (int64, address));
        if (code != SUCCESS) revert ScheduleFailed(code);
    }
}
