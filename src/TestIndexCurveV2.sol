// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IERC20V2 {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Robinhood testnet curve V2: $100 close target and treasury may withdraw at any time.
/// @dev This is a new, independent deployment. It has no access to V1 balances or commitments.
contract TestIndexCurveV2 {
    address public constant TREASURY = 0xb2F6409cF259B8820a733548f575D5B217ea4cCE;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant CURVE_SUPPLY = 200_000_000 ether;
    uint256 public constant CLOSE_INDEX_USD = 100 ether;
    uint256 public constant INITIAL_PRICE_USD = 0.0001 ether;
    uint256 public constant FINAL_PRICE_USD = 0.0009 ether;
    uint256 public constant MIN_COMMIT_USD = 1 ether;
    uint256 public constant MAX_ETH_PER_WALLET = 2 ether;

    uint256 public ethUsdWad;
    string public deploymentName;
    uint256 public totalSold;
    uint256 private _indexUsd;
    uint256 public totalAcceptedWei;
    IERC20V2 public testToken;
    bool public saleOpen;
    bool public bondingComplete;
    bool public claimsOpen;
    uint256 private _entered;

    struct Commitment { uint256 tokens; uint256 usdWad; uint256 weiAccepted; bool claimed; uint32 commits; }
    mapping(address => Commitment) public commitments;
    address[] private _buyers;

    event Committed(address indexed buyer, uint256 weiSent, uint256 weiAccepted, uint256 usdWad, uint256 tokens, uint256 indexUsdAfter);
    event BondingComplete(uint256 indexUsd, uint256 totalSold);
    event Claimed(address indexed buyer, uint256 tokens);
    event EthUsdWadSet(uint256 ethUsdWad);
    event TokenSet(address indexed token);
    event SaleOpenSet(bool isOpen);
    event ClaimsOpenSet(bool isOpen);
    event Withdrawn(uint256 amount);

    modifier onlyTreasury() { require(msg.sender == TREASURY, "only treasury"); _; }
    modifier nonReentrant() { require(_entered != 2, "reentrancy"); _entered = 2; _; _entered = 1; }

    constructor(uint256 initialEthUsdWad, string memory name_) {
        require(initialEthUsdWad != 0, "zero ETH/USD");
        require(bytes(name_).length != 0, "name required");
        ethUsdWad = initialEthUsdWad;
        deploymentName = name_;
        _entered = 1;
    }

    receive() external payable nonReentrant { _commit(); }
    function buy() external payable nonReentrant { _commit(); }

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
        uint256 acceptedWei = usdIn > remaining ? (acceptedUsd * 1 ether) / ethUsdWad : msg.value;
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
        uint256 refund = msg.value - acceptedWei;
        if (refund != 0) {
            (bool refunded, ) = payable(msg.sender).call{value: refund}("");
            require(refunded, "refund failed");
        }
    }

    function currentPriceUsd() public view returns (uint256) {
        return INITIAL_PRICE_USD + ((FINAL_PRICE_USD - INITIAL_PRICE_USD) * totalSold) / CURVE_SUPPLY;
    }
    function indexUsd() external view returns (uint256) { return _indexUsd; }
    function spotFdvUsd() external view returns (uint256) { return (currentPriceUsd() * TOTAL_SUPPLY) / 1 ether; }
    function cumulativeCostUsd(uint256 tokens) public pure returns (uint256) {
        require(tokens <= CURVE_SUPPLY, "outside curve");
        uint256 slope = FINAL_PRICE_USD - INITIAL_PRICE_USD;
        return (INITIAL_PRICE_USD * tokens) / 1 ether + (slope * tokens * tokens) / (2 * CURVE_SUPPLY * 1 ether);
    }
    function tokensForUsd(uint256 soldBefore, uint256 usdWad) public pure returns (uint256) {
        require(soldBefore <= CURVE_SUPPLY, "outside curve");
        uint256 targetCost = cumulativeCostUsd(soldBefore) + usdWad;
        if (targetCost >= CLOSE_INDEX_USD) return CURVE_SUPPLY - soldBefore;
        uint256 slope = FINAL_PRICE_USD - INITIAL_PRICE_USD;
        uint256 radicand = INITIAL_PRICE_USD * INITIAL_PRICE_USD + (2 * slope * targetCost * 1 ether) / CURVE_SUPPLY;
        uint256 soldAfter = (CURVE_SUPPLY * (_sqrt(radicand) - INITIAL_PRICE_USD)) / slope;
        return soldAfter - soldBefore;
    }
    function quote(uint256 weiIn) external view returns (uint256 usdAccepted, uint256 weiAccepted, uint256 tokenOut, uint256 refund) {
        if (!saleOpen || bondingComplete || weiIn == 0) return (0, 0, 0, weiIn);
        uint256 usdIn = (weiIn * ethUsdWad) / 1 ether;
        uint256 remaining = CLOSE_INDEX_USD - _indexUsd;
        usdAccepted = usdIn > remaining ? remaining : usdIn;
        weiAccepted = usdIn > remaining ? (usdAccepted * 1 ether) / ethUsdWad : weiIn;
        tokenOut = tokensForUsd(totalSold, usdAccepted);
        refund = weiIn - weiAccepted;
    }
    function buyerCount() external view returns (uint256) { return _buyers.length; }
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
    function setEthUsdWad(uint256 newEthUsdWad) external onlyTreasury { require(newEthUsdWad != 0, "zero ETH/USD"); ethUsdWad = newEthUsdWad; emit EthUsdWadSet(newEthUsdWad); }
    function setToken(address token) external onlyTreasury { require(token != address(0), "token=0"); testToken = IERC20V2(token); emit TokenSet(token); }
    function setSaleOpen(bool isOpen) external onlyTreasury { require(!bondingComplete, "bonding complete"); saleOpen = isOpen; emit SaleOpenSet(isOpen); }
    function setClaimsOpen(bool isOpen) external onlyTreasury { claimsOpen = isOpen; emit ClaimsOpenSet(isOpen); }

    /// @notice Treasury withdrawal is intentionally allowed before bonding completes in V2.
    function withdraw(uint256 amount) external onlyTreasury nonReentrant {
        require(amount != 0 && amount <= address(this).balance, "bad amount");
        (bool paid, ) = payable(TREASURY).call{value: amount}("");
        require(paid, "withdraw failed");
        emit Withdrawn(amount);
    }
    function rescueToken(address token, uint256 amount) external onlyTreasury nonReentrant { require(IERC20V2(token).transfer(TREASURY, amount), "rescue failed"); }
    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) { z = y; y = (x / y + y) / 2; }
    }
}
