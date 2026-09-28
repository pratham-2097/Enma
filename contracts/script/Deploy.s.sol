// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {EnmaGuard, EnmaCollector} from "../src/EnmaGuard.sol";

/// Deploys EnmaCollector, then EnmaGuard wired to it, against the real x402 escrow.
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("OWNER_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address escrow = vm.envAddress("ESCROW_ADDRESS");

        vm.startBroadcast();

        EnmaCollector collector = new EnmaCollector(escrow);
        EnmaGuard guard = new EnmaGuard(owner, escrow, agent, guardian, address(collector));

        vm.stopBroadcast();

        console.log("EnmaCollector deployed at:", address(collector));
        console.log("EnmaGuard deployed at:", address(guard));
    }
}
