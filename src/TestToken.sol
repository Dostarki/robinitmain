// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

/// @title TestToken
/// @notice Fixed-supply TEST token used only with the Robinhood Chain testnet curve.
contract TestToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 1_000_000_000 ether;
    address public constant TREASURY = 0xb2F6409cF259B8820a733548f575D5B217ea4cCE;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory tokenName, string memory tokenSymbol) {
        require(bytes(tokenName).length != 0, "name required");
        require(bytes(tokenSymbol).length != 0, "symbol required");
        name = tokenName;
        symbol = tokenSymbol;
        balanceOf[TREASURY] = totalSupply;
        emit Transfer(address(0), TREASURY, totalSupply);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        require(permitted >= value, "allowance");
        if (permitted != type(uint256).max) {
            allowance[from][msg.sender] = permitted - value;
            emit Approval(from, msg.sender, permitted - value);
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "to=0");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= value, "balance");
        balanceOf[from] = fromBalance - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
