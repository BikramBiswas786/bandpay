// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface ISupraSValueFeed {
    struct PriceFeed {
        uint256 round;
        uint256 decimals;
        uint256 time;
        uint256 price;
    }

    function getSvalue(uint256 pairIndex) external view returns (PriceFeed memory);
}

interface IHederaTokenService {
    function associateToken(address account, address token) external returns (int64 responseCode);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Escrow a payment and release it only inside an HBAR price band.
///         The payer's own scheduled transaction is what should call release.
///         A third party cannot.
contract BandPay {
    uint256 public constant DISAGREE_BPS = 300;
    uint256 internal constant MILLISECOND_THRESHOLD = 1e11;

    AggregatorV3Interface public immutable chainlink;
    ISupraSValueFeed public immutable supraFeed;
    uint256 public immutable supraPairId;
    uint256 public immutable maxAge;

    struct Plan {
        address payer;
        address recipient;
        address token;
        uint256 amount;
        int256 minPrice;
        int256 maxPrice;
        uint256 executeAt;
        bool funded;
        bool paid;
        bool cancelled;
    }

    uint256 public nextId;
    mapping(uint256 => Plan) public plans;

    error BadState();
    error NotPayer();
    error TooEarly();
    error NoPrice();
    error Disagree(uint256 bps);
    error OutsideBand(int256 price);
    error TransferFailed();
    error ZeroAmount();
    error AssociateFailed(int64 code);

    /// @dev Hedera response code SUCCESS. Anything else means the token was not associated.
    int64 internal constant HTS_SUCCESS = 22;
    address internal constant HTS = address(uint160(0x167));

    constructor(address chainlink_, address supraFeed_, uint256 supraPairId_, uint256 maxAge_) {
        if (chainlink_ == address(0) || supraFeed_ == address(0) || maxAge_ == 0) revert BadState();
        chainlink = AggregatorV3Interface(chainlink_);
        supraFeed = ISupraSValueFeed(supraFeed_);
        supraPairId = supraPairId_;
        maxAge = maxAge_;
    }

    function fundHbar(address recipient, int256 minPrice, int256 maxPrice, uint256 executeAt)
        external
        payable
        returns (uint256 id)
    {
        if (msg.value == 0) revert ZeroAmount();
        id = _open(msg.sender, recipient, address(0), msg.value, minPrice, maxPrice, executeAt);
    }

    function fundToken(
        address recipient,
        address token,
        uint256 amount,
        int256 minPrice,
        int256 maxPrice,
        uint256 executeAt
    ) external returns (uint256 id) {
        if (amount == 0 || token == address(0)) revert ZeroAmount();
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        id = _open(msg.sender, recipient, token, amount, minPrice, maxPrice, executeAt);
    }

    /// @dev Call this from a Schedule Service transaction signed by the payer.
    function release(uint256 id) external {
        Plan storage plan = plans[id];
        if (!plan.funded || plan.paid || plan.cancelled) revert BadState();
        if (msg.sender != plan.payer) revert NotPayer();
        if (block.timestamp < plan.executeAt) revert TooEarly();
        int256 price = _price();
        if (price < plan.minPrice || price > plan.maxPrice) revert OutsideBand(price);
        plan.paid = true;
        _send(plan.token, plan.recipient, plan.amount);
    }

    /// @notice Call once per HTS token, before fundToken. The contract cannot hold the token until this succeeds.
    ///         Removing it leaves an escrow that reverts on every token, because Hedera will not credit an unassociated account.
    function associate(address token) external {
        if (token == address(0)) revert ZeroAmount();
        (bool ok, bytes memory data) = HTS.call(
            abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), token)
        );
        if (!ok || data.length < 32) revert AssociateFailed(-1);
        int64 code = abi.decode(data, (int64));
        if (code != HTS_SUCCESS) revert AssociateFailed(code);
    }

    function cancel(uint256 id) external {
        Plan storage plan = plans[id];
        if (!plan.funded || plan.paid || plan.cancelled) revert BadState();
        if (msg.sender != plan.payer) revert NotPayer();
        plan.cancelled = true;
        _send(plan.token, plan.payer, plan.amount);
    }

    function _open(
        address payer,
        address recipient,
        address token,
        uint256 amount,
        int256 minPrice,
        int256 maxPrice,
        uint256 executeAt
    ) internal returns (uint256 id) {
        if (recipient == address(0) || minPrice <= 0 || maxPrice < minPrice) revert BadState();
        id = nextId++;
        plans[id] = Plan({
            payer: payer,
            recipient: recipient,
            token: token,
            amount: amount,
            minPrice: minPrice,
            maxPrice: maxPrice,
            executeAt: executeAt,
            funded: true,
            paid: false,
            cancelled: false
        });
    }

    function _price() internal view returns (int256) {
        (bool clFresh, int256 cl) = _chainlink();
        (bool suFresh, int256 su) = _supra();
        if (clFresh && suFresh) {
            uint256 hi = cl > su ? uint256(cl) : uint256(su);
            uint256 lo = cl > su ? uint256(su) : uint256(cl);
            uint256 bps = ((hi - lo) * 10_000) / uint256(cl);
            if (bps > DISAGREE_BPS) revert Disagree(bps);
            return cl;
        }
        if (clFresh) return cl;
        if (suFresh) return su;
        revert NoPrice();
    }

    function _chainlink() internal view returns (bool fresh, int256 answer) {
        try chainlink.latestRoundData() returns (uint80, int256 price, uint256, uint256 updatedAt, uint80) {
            if (price <= 0 || updatedAt == 0 || updatedAt > block.timestamp) return (false, 0);
            if (block.timestamp - updatedAt > maxAge) return (false, 0);
            return (true, _scale(price, chainlink.decimals()));
        } catch {
            return (false, 0);
        }
    }

    function _supra() internal view returns (bool fresh, int256 answer) {
        try supraFeed.getSvalue(supraPairId) returns (ISupraSValueFeed.PriceFeed memory feed) {
            if (feed.price == 0 || feed.time == 0 || feed.decimals > 18) return (false, 0);
            uint256 updatedAt = feed.time > MILLISECOND_THRESHOLD ? feed.time / 1000 : feed.time;
            if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxAge) return (false, 0);
            return (true, _scale(int256(feed.price), uint8(feed.decimals)));
        } catch {
            return (false, 0);
        }
    }

    function _scale(int256 value, uint8 decimals) internal pure returns (int256) {
        if (decimals == 8) return value;
        if (decimals < 8) return value * int256(10 ** (8 - decimals));
        return value / int256(10 ** (decimals - 8));
    }

    function _send(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else if (!IERC20(token).transfer(to, amount)) {
            revert TransferFailed();
        }
    }
}
