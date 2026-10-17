// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/Probon.sol";

interface VmDeploy {
    function envUint(string calldata key) external returns (uint256);
    function envAddress(string calldata key) external returns (address);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployProbon {
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (Probon deployed) {
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address expectedDeployer = vm.envAddress("EXPECTED_DEPLOYER_ADDRESS");
        require(expectedDeployer != address(0), "expected deployer required");
        require(vm.addr(privateKey) == expectedDeployer, "private key address mismatch");
        vm.startBroadcast(privateKey);
        deployed = new Probon();
        vm.stopBroadcast();
    }
}
