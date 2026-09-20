// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

/// @notice Minimal ERC-20 surface used by the claim and rescue paths.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title TestIndexCurve
/// @notice Testnet adaptation of the $TEST direct-payment bonding curve
///         at 0xCb596Dd8fc330E7a7da0D3333dBE012a018646Da on Robinhood Chain.
/// @dev The original explorer entry exposes bytecode and compiler metadata, but not
///      verified Solidity source. This contract reproduces its advertised economics;
///      it is not source-identical and should not be used as a deployment replacement
///      without an independent audit and byte-for-byte behavioural comparison.
contract TestIndexCurve {
    /// @dev The newly created test wallet is the sole treasury and administrator.
    address public constant TREASURY = 0xb2F6409cF259B8820a733548f575D5B217ea4cCE;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_SUPPLY = 200_000_000 ether;
    uint256 public constant CLOSE_INDEX_USD = 100_000 ether;
    uint256 public constant INITIAL_PRICE_USD = 0.0001 ether;
    uint256 public constant FINAL_PRICE_USD = 0.0009 ether;
    uint256 public constant MIN_COMMIT_USD = 1 ether;
    uint256 public constant MAX_ETH_PER_WALLET = 2 ether;

    /// @dev USD per ETH, WAD scaled. This is an administrative quote, not an oracle.
    uint256 public ethUsdWad;
    uint256 public totalSold;
    uint256 private _indexUsd;
    uint256 public totalAcceptedWei;

    IERC20 public testToken;
    bool public saleOpen;
    bool public bondingComplete;
    bool public claimsOpen;
    uint256 private _entered;

    struct Commitment {
        uint256 tokens;
        uint256 usdWad;
        uint256 weiAccepted;
        bool claimed;
        uint32 commits;
    }

    mapping(address => Commitment) public commitments;
    address[] private _buyers;

    event Committed(
        address indexed buyer,
        uint256 weiSent,
        uint256 weiAccepted,
        uint256 usdWad,
        uint256 tokens,
        uint256 indexUsdAfter
    );
    event BondingComplete(uint256 indexUsd, uint256 totalSold);
    event Claimed(address indexed buyer, uint256 tokens);
    event EthUsdWadSet(uint256 ethUsdWad);
    event TokenSet(address indexed token);
    event SaleOpenSet(bool isOpen);
    event ClaimsOpenSet(bool isOpen);
    event Withdrawn(uint256 amount);

    modifier onlyTreasury() {
        require(msg.sender == TREASURY, "only treasury");
        _;
    }

    modifier nonReentrant() {
        require(_entered != 2, "reentrancy");
        _entered = 2;
        _;
        _entered = 1;
    }

    constructor(uint256 initialEthUsdWad) {
        require(initialEthUsdWad != 0, "zero ETH/USD");
        ethUsdWad = initialEthUsdWad;
        _entered = 1;
    }

    /// @notice Accept a direct native-ETH commitment. Extra ETH on the final buy is returned.
    receive() external payable nonReentrant {
        _commit();
    }

    /// @notice Explicit equivalent of receive(), convenient for contract integrations.
    function buy() external payable nonReentrant {
        _commit();
    }

    function _commit() private {
        require(saleOpen, "sale not open");
        require(!bondingComplete, "bonding complete");
        require(msg.value != 0, "zero ETH");

        Commitment storage lot = commitments[msg.sender];
        require(lot.weiAccepted + msg.value <= MAX_ETH_PER_WALLET, "wallet cap");

        uint256 usdIn = (msg.value * ethUsdWad) / 1 ether;
        require(usdIn >= MIN_COMMIT_USD, "min $1");

        uint256 remaining = CLOSE_INDEX_USD - _indexUsd;
        uint256 acceptedUsd = usdIn > remaining ? remaining : usdIn;
        uint256 acceptedWei = usdIn > remaining
            ? (acceptedUsd * 1 ether) / ethUsdWad
            : msg.value;
        uint256 refund = msg.value - acceptedWei;

        uint256 tokenOut = tokensForUsd(totalSold, acceptedUsd);
        uint256 remainingTokens = CURVE_SUPPLY - totalSold;
        if (tokenOut > remainingTokens) tokenOut = remainingTokens;
        require(tokenOut != 0, "zero allocation");

        if (lot.commits == 0) _buyers.push(msg.sender);
        lot.tokens += tokenOut;
        lot.usdWad += acceptedUsd;
        lot.weiAccepted += acceptedWei;
        lot.commits += 1;

        totalSold += tokenOut;
        _indexUsd += acceptedUsd;
        totalAcceptedWei += acceptedWei;

        if (_indexUsd == CLOSE_INDEX_USD || totalSold == CURVE_SUPPLY) {
            bondingComplete = true;
            emit BondingComplete(_indexUsd, totalSold);
        }

        emit Committed(msg.sender, msg.value, acceptedWei, acceptedUsd, tokenOut, _indexUsd);

        if (refund != 0) {
            (bool refunded, ) = payable(msg.sender).call{value: refund}("");
            require(refunded, "refund failed");
        }
    }

    /// @notice The marginal price at the present quantity sold, in USD WAD per token.
    function currentPriceUsd() public view returns (uint256) {
        return INITIAL_PRICE_USD + ((FINAL_PRICE_USD - INITIAL_PRICE_USD) * totalSold) / CURVE_SUPPLY;
    }

    /// @notice The sale's cumulative cost basis. This is the site's "Index".
    function indexUsd() external view returns (uint256) {
        return _indexUsd;
    }

    /// @notice Full-supply valuation implied by the current marginal curve price.
    function spotFdvUsd() external view returns (uint256) {
        return (currentPriceUsd() * TOTAL_SUPPLY) / 1 ether;
    }

    /// @notice Integral cost of travelling from q=0 to q=tokens on the curve.
    function cumulativeCostUsd(uint256 tokens) public pure returns (uint256) {
        require(tokens <= CURVE_SUPPLY, "outside curve");
        uint256 slope = FINAL_PRICE_USD - INITIAL_PRICE_USD;
        return (INITIAL_PRICE_USD * tokens) / 1 ether
            + (slope * tokens * tokens) / (2 * CURVE_SUPPLY * 1 ether);
    }

    /// @notice Token amount received for a USD amount after `soldBefore` tokens have sold.
    /// @dev Inverts the integral of p(q) = p0 + (p1-p0)q/S.
    function tokensForUsd(uint256 soldBefore, uint256 usdWad) public pure returns (uint256) {
        require(soldBefore <= CURVE_SUPPLY, "outside curve");
        uint256 targetCost = cumulativeCostUsd(soldBefore) + usdWad;
        if (targetCost >= CLOSE_INDEX_USD) return CURVE_SUPPLY - soldBefore;

        uint256 slope = FINAL_PRICE_USD - INITIAL_PRICE_USD;
        // q = S/b * (sqrt(p0^2 + 2*b*I*WAD/S) - p0)
        uint256 radicand = INITIAL_PRICE_USD * INITIAL_PRICE_USD
            + (2 * slope * targetCost * 1 ether) / CURVE_SUPPLY;
        uint256 soldAfter = (CURVE_SUPPLY * (_sqrt(radicand) - INITIAL_PRICE_USD)) / slope;
        return soldAfter - soldBefore;
    }

    /// @notice Returns the state transition a direct ETH payment would make now.
    function quote(uint256 weiIn)
        external
        view
        returns (uint256 usdAccepted, uint256 weiAccepted, uint256 tokenOut, uint256 refund)
    {
        if (!saleOpen || bondingComplete || weiIn == 0) return (0, 0, 0, weiIn);
        uint256 usdIn = (weiIn * ethUsdWad) / 1 ether;
        uint256 remaining = CLOSE_INDEX_USD - _indexUsd;
        usdAccepted = usdIn > remaining ? remaining : usdIn;
        weiAccepted = usdIn > remaining ? (usdAccepted * 1 ether) / ethUsdWad : weiIn;
        tokenOut = tokensForUsd(totalSold, usdAccepted);
        refund = weiIn - weiAccepted;
    }

    function buyerCount() external view returns (uint256) {
        return _buyers.length;
    }

    function buyers(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        if (offset >= _buyers.length) return new address[](0);
        uint256 end = offset + limit;
        if (end > _buyers.length) end = _buyers.length;
        page = new address[](end - offset);
        for (uint256 i; i < page.length; ++i) page[i] = _buyers[offset + i];
    }

    function claim() external nonReentrant {
        require(bondingComplete && claimsOpen, "claims not open");
        Commitment storage lot = commitments[msg.sender];
        require(!lot.claimed && lot.tokens != 0, "nothing to claim");
        lot.claimed = true;
        require(address(testToken) != address(0), "token unset");
        require(testToken.transfer(msg.sender, lot.tokens), "token transfer failed");
        emit Claimed(msg.sender, lot.tokens);
    }

    function setEthUsdWad(uint256 newEthUsdWad) external onlyTreasury {
        require(newEthUsdWad != 0, "zero ETH/USD");
        ethUsdWad = newEthUsdWad;
        emit EthUsdWadSet(newEthUsdWad);
    }

    function setToken(address token) external onlyTreasury {
        require(token != address(0), "token=0");
        testToken = IERC20(token);
        emit TokenSet(token);
    }

    function setSaleOpen(bool isOpen) external onlyTreasury {
        require(!bondingComplete, "bonding complete");
        saleOpen = isOpen;
        emit SaleOpenSet(isOpen);
    }

    function setClaimsOpen(bool isOpen) external onlyTreasury {
        claimsOpen = isOpen;
        emit ClaimsOpenSet(isOpen);
    }

    function withdraw(uint256 amount) external onlyTreasury nonReentrant {
        require(bondingComplete, "bonding not complete");
        require(amount != 0 && amount <= address(this).balance, "bad amount");
        (bool paid, ) = payable(TREASURY).call{value: amount}("");
        require(paid, "withdraw failed");
        emit Withdrawn(amount);
    }

    function rescueToken(address token, uint256 amount) external onlyTreasury nonReentrant {
        require(IERC20(token).transfer(TREASURY, amount), "rescue failed");
    }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }
}
