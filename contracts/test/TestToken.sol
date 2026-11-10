// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    address public blockedRecipient;
    constructor() ERC20("Test USD", "TUSD") { _mint(msg.sender, 1_000_000_000); }
    function decimals() public pure override returns (uint8) { return 6; }
    function setBlockedRecipient(address recipient) external { blockedRecipient = recipient; }
    function _update(address from, address to, uint256 value) internal override {
        require(to != blockedRecipient, "blocked");
        super._update(from, to, value);
    }
}
