// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Liquidity Provider Token
 * @notice ERC20 token representing a user's share of a StableSwap pool.
 * Vendored from Saddle Finance (MIT). Converted from upgradeable to standard OZ v5.
 * Only the owning Swap contract may mint tokens.
 */
contract LPToken is ERC20Burnable, Ownable {
    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {}

    /**
     * @notice Mints the given amount of LPToken to the recipient.
     * @dev only owner can call this mint function
     * @param recipient address of account to receive the tokens
     * @param amount amount of tokens to mint
     */
    function mint(address recipient, uint256 amount) external onlyOwner {
        require(amount != 0, "LPToken: cannot mint 0");
        _mint(recipient, amount);
    }

    /**
     * @dev Overrides ERC20._update() which is called on every transfer including
     * minting and burning. Prevents sending tokens to the contract itself.
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20) {
        require(to != address(this), "LPToken: cannot send to itself");
        super._update(from, to, amount);
    }
}
