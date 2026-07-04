// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev A non-standard ERC20 that withholds a fee on every transfer, so the
///      amount credited to `to` is LESS than the amount debited from `from`.
///      Used only to prove why ArcFXGateway's exact-transfer-only token policy
///      must hold (Audit M3, 2026-07-04). Never deploy to a live chain.
contract FeeOnTransferERC20 is ERC20 {
    uint8   private immutable _dec;
    uint16  public  immutable feeBps; // e.g. 100 = 1%
    address public  constant  SINK = address(0xFEE);

    constructor(string memory name, string memory sym, uint8 dec, uint16 feeBps_)
        ERC20(name, sym)
    {
        _dec = dec;
        feeBps = feeBps_;
    }

    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    /// On a real transfer (not mint/burn) withhold `feeBps` of the value: the
    /// fee is routed to SINK, so `to` receives value - fee while `from` is
    /// debited the full value.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 0 && feeBps > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            if (fee > 0) {
                super._update(from, SINK, fee);
                value -= fee;
            }
        }
        super._update(from, to, value);
    }
}
