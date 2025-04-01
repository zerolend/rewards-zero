import { ethers, run } from "hardhat";
import { RewardToken } from "../typechain-types/contracts/RewardToken";

async function main() {
  console.log("Starting RewardToken deployment...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Get the ZERO token address from environment variable
  const ZERO_TOKEN_ADDRESS = process.env.ZERO_TOKEN_ADDRESS;
  if (!ZERO_TOKEN_ADDRESS) {
    throw new Error("ZERO_TOKEN_ADDRESS environment variable is not set");
  }

  // Get the remainder receiver address from environment variable
  const REMAINDER_RECEIVER_ADDRESS = process.env.REMAINDER_RECEIVER_ADDRESS;
  if (!REMAINDER_RECEIVER_ADDRESS) {
    throw new Error("REMAINDER_RECEIVER_ADDRESS environment variable is not set");
  }

  // Deploy RewardToken
  const RewardToken = await ethers.getContractFactory("RewardToken");
  const rewardToken = await RewardToken.deploy(
    deployer.address, // owner
    REMAINDER_RECEIVER_ADDRESS, // remainder receiver
    ZERO_TOKEN_ADDRESS // underlying token (ZERO)
  );

  await rewardToken.waitForDeployment();
  const rewardTokenAddress = await rewardToken.getAddress();
  console.log("RewardToken deployed to:", rewardTokenAddress);

  // Wait for a few block confirmations to ensure the deployment is confirmed
  console.log("Waiting for block confirmations...");
  await rewardToken.deploymentTransaction()?.wait(5);
  console.log("Block confirmations received");

  // Verify the contract on Etherscan
  if (process.env.ETHERSCAN_API_KEY) {
    console.log("Verifying contract on Etherscan...");
    try {
      await run("verify:verify", {
        address: rewardTokenAddress,
        constructorArguments: [
          deployer.address,
          REMAINDER_RECEIVER_ADDRESS,
          ZERO_TOKEN_ADDRESS,
        ],
      });
      console.log("Contract verified successfully");
    } catch (error) {
      console.error("Error verifying contract:", error);
    }
  } else {
    console.log("Skipping verification - ETHERSCAN_API_KEY not set");
  }

  console.log("Deployment completed successfully!");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 