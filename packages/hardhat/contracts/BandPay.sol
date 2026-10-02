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

interface ISaucerRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
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
    address public immutable router;
    address public immutable whbar;
    address public immutable usdc;

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
        int256 usdAmount;
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
    error Underfunded(uint256 owed, uint256 escrow);
    error AssociateFailed(int64 code);
    error NoPool();
    error PoolOff(uint256 poolPrice, uint256 oraclePrice);

    event Funded(
        uint256 indexed id,
        address payer,
        address recipient,
        address token,
        uint256 amount,
        int256 minPrice,
        int256 maxPrice,
        uint256 executeAt,
        int256 usdAmount
    );
    event Released(uint256 indexed id, int256 price, uint256 payout);
    event Cancelled(uint256 indexed id);
    event Attempted(uint256 indexed id, bool paid, bytes reason);

    /// @dev Hedera response code SUCCESS. Anything else means the token was not associated.
    int64 internal constant HTS_SUCCESS = 22;
    address internal constant HTS = address(uint160(0x167));

    /// @dev router, whbar and usdc may be zero. A dollar invoice then reverts NoPool.
    ///      USDC is 6 decimals. The pool price is quote * 1e10 / hbarIn, in the same 8 decimals as the oracles.
    constructor(
        address chainlink_,
        address supraFeed_,
        uint256 supraPairId_,
        uint256 maxAge_,
        address router_,
        address whbar_,
        address usdc_
    ) {
        if (chainlink_ == address(0) || supraFeed_ == address(0) || maxAge_ == 0) revert BadState();
        if (router_ != address(0) && (whbar_ == address(0) || usdc_ == address(0))) revert BadState();
        chainlink = AggregatorV3Interface(chainlink_);
        supraFeed = ISupraSValueFeed(supraFeed_);
        supraPairId = supraPairId_;
        maxAge = maxAge_;
        router = router_;
        whbar = whbar_;
        usdc = usdc_;
    }

    function fundHbar(address recipient, int256 minPrice, int256 maxPrice, uint256 executeAt)
        external
        payable
        returns (uint256 id)
    {
        if (msg.value == 0) revert ZeroAmount();
        id = _open(msg.sender, recipient, address(0), msg.value, minPrice, maxPrice, executeAt, 0);
    }

    /// @notice Escrow HBAR. At release, pay `usdAmount` (8 decimals) of HBAR at the checked price and refund the rest.
    ///         The oracle both allows the payment and sets its size. If the price makes the payout larger than the escrow, release reverts.
    function fundHbarUsd(
        address recipient,
        int256 usdAmount,
        int256 minPrice,
        int256 maxPrice,
        uint256 executeAt
    ) external payable returns (uint256 id) {
        if (msg.value == 0 || usdAmount <= 0) revert ZeroAmount();
        id = _open(msg.sender, recipient, address(0), msg.value, minPrice, maxPrice, executeAt, usdAmount);
    }

    /// @notice Split the escrow into `count` equal plans, due `every` seconds apart. `count` is at most 12.
    function fundHbarInstallments(
        address recipient,
        uint256 count,
        uint256 every,
        int256 minPrice,
        int256 maxPrice,
        uint256 firstExecuteAt
    ) external payable returns (uint256 firstId) {
        if (count == 0 || count > 12 || every == 0 || msg.value == 0 || msg.value % count != 0) revert BadState();
        uint256 each = msg.value / count;
        for (uint256 i = 0; i < count; i++) {
            uint256 id = _open(
                msg.sender,
                recipient,
                address(0),
                each,
                minPrice,
                maxPrice,
                firstExecuteAt + i * every,
                0
            );
            if (i == 0) firstId = id;
        }
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
        id = _open(msg.sender, recipient, token, amount, minPrice, maxPrice, executeAt, 0);
    }

    /// @dev Call this from a Schedule Service transaction signed by the payer.
    ///      If it reverts, the schedule is a failed attempt and the escrow stays.
    function release(uint256 id) external {
        _release(id, true);
    }

    /// @notice Same payment as release, but a refusal is caught. The schedule transaction succeeds either way.
    ///         reason is empty when it paid, and the revert bytes (OutsideBand, NoPrice, Disagree, TooEarly, Underfunded) when it did not.
    function attempt(uint256 id) external {
        if (msg.sender != plans[id].payer) revert NotPayer();
        try this.releaseFromAttempt(id) {
            emit Attempted(id, true, "");
        } catch (bytes memory reason) {
            emit Attempted(id, false, reason);
        }
    }

    /// @dev Only attempt may call this. The payer was already checked.
    function releaseFromAttempt(uint256 id) external {
        if (msg.sender != address(this)) revert NotPayer();
        _release(id, false);
    }

    function _release(uint256 id, bool checkPayer) internal {
        Plan storage plan = plans[id];
        if (!plan.funded || plan.paid || plan.cancelled) revert BadState();
        if (checkPayer && msg.sender != plan.payer) revert NotPayer();
        if (block.timestamp < plan.executeAt) revert TooEarly();
        int256 price = _price();
        if (price < plan.minPrice || price > plan.maxPrice) revert OutsideBand(price);
        uint256 payout = plan.amount;
        if (plan.usdAmount > 0) {
            if (plan.token != address(0)) revert BadState();
            uint256 owed = (uint256(plan.usdAmount) * 100_000_000) / uint256(price);
            if (owed == 0 || owed > plan.amount) revert Underfunded(owed, plan.amount);
            payout = owed;
            _requirePool(payout, uint256(price));
        }
        plan.paid = true;
        emit Released(id, price, payout);
        _send(plan.token, plan.recipient, payout);
        if (payout < plan.amount) _send(plan.token, plan.payer, plan.amount - payout);
    }

    /// @dev SaucerSwap V1 getAmountsOut. A dollar invoice does not pay if this pool is more than 3% off the oracle.
    function _requirePool(uint256 hbarIn, uint256 oraclePrice) internal view {
        if (router == address(0) || hbarIn == 0) revert NoPool();
        address[] memory path = new address[](2);
        path[0] = whbar;
        path[1] = usdc;
        uint256[] memory amounts = ISaucerRouter(router).getAmountsOut(hbarIn, path);
        uint256 out = amounts[amounts.length - 1];
        if (out == 0) revert NoPool();
        uint256 poolPrice = (out * 1e10) / hbarIn;
        uint256 diff = poolPrice > oraclePrice ? poolPrice - oraclePrice : oraclePrice - poolPrice;
        if ((diff * 10000) / oraclePrice > DISAGREE_BPS) revert PoolOff(poolPrice, oraclePrice);
    }

    /// @notice Permissionless on purpose. Associating a token anyone can name does not move funds.
    ///         The contract still cannot hold that token until this returns code 22.
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
        emit Cancelled(id);
        _send(plan.token, plan.payer, plan.amount);
    }

    function _open(
        address payer,
        address recipient,
        address token,
        uint256 amount,
        int256 minPrice,
        int256 maxPrice,
        uint256 executeAt,
        int256 usdAmount
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
            cancelled: false,
            usdAmount: usdAmount
        });
        emit Funded(id, payer, recipient, token, amount, minPrice, maxPrice, executeAt, usdAmount);
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
