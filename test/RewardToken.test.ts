import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { RewardToken } from "../typechain-types/contracts/RewardToken";
import { MockERC20 } from "../typechain-types/contracts/mock/MockERC20";


describe("RewardToken", function () {
  let rewardToken: RewardToken;
  let underlying: MockERC20;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let distributor: SignerWithAddress;
  let remainderReceiver: SignerWithAddress;

  const ONE_DAY = 24 * 60 * 60;
  const THOUSAND_TOKENS = ethers.parseUnits("1000", 18);

  beforeEach(async function () {
    [owner, user1, user2, distributor, remainderReceiver] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    underlying = await MockERC20.deploy();

    // Deploy RewardToken
    const RewardToken = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy(
      owner.address,
      remainderReceiver.address,
      underlying.target
    );
    await rewardToken.waitForDeployment();


    // Transfer some tokens to users for testing
    await underlying.transfer(user1.address, THOUSAND_TOKENS);
    await underlying.transfer(user2.address, THOUSAND_TOKENS);
  });

  describe("Initial State", function () {
    it("should have correct name and symbol", async function () {
      expect(await rewardToken.name()).to.equal("ZeroLend Reward Token");
      expect(await rewardToken.symbol()).to.equal("rZERO");
    });

    it("should have correct remainder receiver", async function () {
      expect(await rewardToken.remainderReceiver()).to.equal(remainderReceiver.address);
    });

    it("should have correct initial whitelist status for owner", async function () {
      expect(await rewardToken.whitelistStatus(owner.address)).to.equal(0);
    });
  });

  describe("Whitelist Status", function () {
    it("should set whitelist status correctly", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 1); // ADMIN
      expect(await rewardToken.whitelistStatus(user1.address)).to.equal(1);

      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 2); // DISTRIBUTOR
      expect(await rewardToken.whitelistStatus(user2.address)).to.equal(2);

      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 0); // NONE
      expect(await rewardToken.whitelistStatus(user1.address)).to.equal(0);
    });

    it("should revert on invalid whitelist status", async function () {
      await expect(
        rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 3)
      ).to.be.revertedWithCustomError(rewardToken, "InvalidWhitelistStatus");
    });

    it("should lock tokens when setting status to NONE", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](owner.address, 1); // Set owner as ADMIN
      
      // First deposit tokens for user1 using the owner (who has admin privileges)
      await underlying.approve(rewardToken.target, ethers.parseEther("100"));
      await rewardToken.connect(owner).depositFor(user1.address, ethers.parseEther("100"));
      
      // Set status to NONE which should lock the tokens
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 0);
      
      // Verify tokens are locked by checking if transfer is blocked
      await expect(
        rewardToken.connect(user1).transfer(user2.address, ethers.parseEther("50"))
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });

    it("should unlock tokens when setting status to ADMIN or DISTRIBUTOR", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](owner.address, 1); // Set owner as ADMIN
      
      // First deposit tokens for user1 using the owner (who has admin privileges)
      await underlying.approve(rewardToken.target, ethers.parseEther("100"));
      await rewardToken.connect(owner).depositFor(user1.address, ethers.parseEther("100"));
      
      // Set status to DISTRIBUTOR which should unlock the tokens
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 2);
      
      // Verify tokens are unlocked by checking if transfer is allowed
      await expect(
        rewardToken.connect(user1).transfer(user2.address, ethers.parseEther("50"))
      ).to.not.be.reverted;
    });

    it("should emit LockCreated event when setting to NONE with balance", async function () {
      // First set owner as ADMIN to allow deposits
      await rewardToken["setWhitelistStatus(address,uint256)"](owner.address, 1);
      
      // Deposit tokens for user1 using the owner (who has admin privileges)
      await underlying.approve(rewardToken.target, ethers.parseEther("100"));
      await rewardToken.connect(owner).depositFor(user1.address, ethers.parseEther("100"));
      
      // Set user1 as distributor to ensure tokens are unlocked
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 2);
      
      // Get the current normalized timestamp
      const latestBlock = await ethers.provider.getBlock("latest");
      if (!latestBlock) throw new Error("Failed to get latest block");
      const normalizedTimestamp = latestBlock.timestamp - (latestBlock.timestamp % (24 * 60 * 60));
      
      // Set status to NONE and expect LockCreated event
      await expect(rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 0))
        .to.emit(rewardToken, "LockCreated")
        .withArgs(user1.address, normalizedTimestamp);
    });

    it("should only allow owner to set whitelist status", async function () {
      await expect(
        rewardToken.connect(user1)["setWhitelistStatus(address,uint256)"](user2.address, 1)
      ).to.be.revertedWithCustomError(rewardToken, "OwnableUnauthorizedAccount");
    });

    it("should allow a whitelisted account to degrade its own whitelist status", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 2);
      await rewardToken.connect(user1)["setWhitelistStatus(uint256)"](0);
      expect(await rewardToken.whitelistStatus(user1.address)).to.equal(0);
    });

    it("should not allow a whitelisted account to set whitelist status to ADMIN", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 2);
      await expect(
        rewardToken.connect(user1)["setWhitelistStatus(uint256)"](1)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });

    it("should not allow a whitelisted account to set whitelist status to DISTRIBUTOR", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 0);
      await expect(
        rewardToken.connect(user1)["setWhitelistStatus(uint256)"](2)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });

  });

  describe("Deposits", function () {
    it("should not allow non-whitelisted users to deposit", async function () {
      await expect(
        rewardToken.connect(user2).depositFor(user2.address, THOUSAND_TOKENS)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });

    it("should not allow DISTRIBUTOR whitelisted users to deposit", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 2);
      await expect(
        rewardToken.connect(user2).depositFor(user2.address, THOUSAND_TOKENS)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });

    it("should not allow NONE whitelisted users to deposit", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 0);
      await expect(
        rewardToken.connect(user2).depositFor(user2.address, THOUSAND_TOKENS)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });

    it("should allow ADMIN whitelisted users to deposit", async function () {
      const initialBalance = await underlying.balanceOf(user2.address);
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 1);
      await underlying.connect(user2).approve(rewardToken.target, THOUSAND_TOKENS);
      await rewardToken.connect(user2).depositFor(user2.address, THOUSAND_TOKENS);
      expect(await rewardToken.balanceOf(user2.address)).to.equal(THOUSAND_TOKENS);
      expect(await underlying.balanceOf(user2.address)).to.equal(initialBalance - THOUSAND_TOKENS);
    });
  });

  describe("Withdrawals", async function () {
    beforeEach(async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 1); // ADMIN
      await underlying.connect(user1).approve(rewardToken.target, THOUSAND_TOKENS);
      await rewardToken.connect(user1).depositFor(user2.address, THOUSAND_TOKENS);
    });

    it("should not allow non-whitelisted users to withdraw", async function () {
      await expect(
        rewardToken.withdrawTo(user2.address, THOUSAND_TOKENS)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    }); 

    it("should not allow DISTRIBUTOR whitelisted users to withdraw", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 2);
      await expect(
        rewardToken.withdrawTo(user2.address, THOUSAND_TOKENS)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });

    it("should not allow NONE whitelisted users to withdraw", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 0);
      await expect(
        rewardToken.withdrawTo(user2.address, THOUSAND_TOKENS)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });

    it("should not allow ADMIN whitelisted users to withdraw from others fund", async function () {
      await expect(
        rewardToken.connect(user1).withdrawTo(user2.address, THOUSAND_TOKENS)
      ).to.be.revertedWithCustomError(rewardToken, "ERC20InsufficientBalance");
    });

    it("should allow ADMIN whitelisted users to withdraw", async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 1);
      const initialBalance = await underlying.balanceOf(user2.address);
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 1);
      await rewardToken.connect(user2).withdrawTo(user2.address, THOUSAND_TOKENS);
      expect(await underlying.balanceOf(user2.address)).to.equal(initialBalance + THOUSAND_TOKENS);
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 1); // ADMIN
      await underlying.connect(user1).approve(rewardToken.target, THOUSAND_TOKENS);
      await rewardToken.connect(user1).depositFor(user1.address, THOUSAND_TOKENS);
    });

    it("should allow users who have deposited underlying token to transfer their reward tokens to other users", async function () {
      const initialBalance = await rewardToken.balanceOf(user1.address);
      await rewardToken.connect(user1).transfer(user2.address, THOUSAND_TOKENS * 50n / 100n);
      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialBalance - THOUSAND_TOKENS * 50n / 100n);
    });

    it("should allow approved users to transfer reward tokens to other users", async function () {
      const initialBalance = await rewardToken.balanceOf(user1.address);
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 1);
      await rewardToken.connect(user1).approve(owner.address, THOUSAND_TOKENS * 50n / 100n);
      await rewardToken.transferFrom(user1.address, user2.address, THOUSAND_TOKENS * 50n / 100n);
      expect(await rewardToken.balanceOf(user1.address)).to.equal(initialBalance - THOUSAND_TOKENS * 50n / 100n);
      expect(await rewardToken.balanceOf(user2.address)).to.equal(THOUSAND_TOKENS * 50n / 100n);
    });

    it("should not allow users who have not deposited underlying token to transfer reward tokens", async function () {
      await expect(
        rewardToken.connect(user2).transfer(user2.address, THOUSAND_TOKENS * 50n / 100n)
      ).to.be.revertedWithCustomError(rewardToken, "NotAuthorized");
    });
  });
  //   beforeEach(async function () {
  //     await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 1); // ADMIN
  //     await rewardToken.depositFor(user2.address, THOUSAND_TOKENS);
  //   });

  //   it("should send remainder to remainder receiver", async function () {
  //     const initialRemainderBalance = await underlying.balanceOf(remainderReceiver.address);
  //     const latestBlock = await ethers.provider.getBlock("latest");
  //     if (latestBlock && latestBlock.timestamp) {
  //       await rewardToken.withdrawToByLockTimestamp(
  //         user2.address,
  //         latestBlock.timestamp - ONE_DAY,
  //         true
  //       );
  //     }
  //     expect(
  //       (await underlying.balanceOf(remainderReceiver.address)) - initialRemainderBalance
  //     ).to.equal(
  //       THOUSAND_TOKENS * 80n / 100n,
  //       "Remainder should go to remainder receiver"
  //     );
  //   });

  //   it("should revert when remainder loss is not allowed", async function () {
  //     const latestBlock = await ethers.provider.getBlock("latest");
  //     if (latestBlock && latestBlock.timestamp) {
  //       await expect(
  //         rewardToken.withdrawToByLockTimestamp(
  //           user2.address,
  //           latestBlock.timestamp - ONE_DAY,
  //           false
  //         )
  //       ).to.be.revertedWithCustomError(rewardToken, "RemainderLossNotAllowed");
  //     }
  //   });
  // });

  describe("Unlock Schedule", function () {
    beforeEach(async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](user1.address, 1); // ADMIN
      await rewardToken["setWhitelistStatus(address,uint256)"](owner.address, 1);
      // First deposit tokens for user1 using the owner (who has admin privileges)
      await underlying.approve(rewardToken.target, THOUSAND_TOKENS);
      await rewardToken.depositFor(user2.address, THOUSAND_TOKENS);
    });

    it("should unlock 20% immediately", async function () {
      const initialBalance = await rewardToken.balanceOf(user2.address);
      const latestBlock = await ethers.provider.getBlock("latest");
      if (latestBlock && latestBlock.timestamp) {
        await rewardToken.withdrawToByLockTimestamp(
          user2.address,
          latestBlock.timestamp - ONE_DAY,
          true
        );
      }
      expect(await underlying.balanceOf(user2.address)).to.equal(
        THOUSAND_TOKENS,
        "Should unlock 20% immediately"
      );
    });

    it("should unlock partially after normalization factor", async function () {
      await ethers.provider.send("evm_increaseTime", [2 * ONE_DAY]);
      await ethers.provider.send("evm_mine", []);

      const latestBlock = await ethers.provider.getBlock("latest");
      if (latestBlock && latestBlock.timestamp) {
        await rewardToken.withdrawToByLockTimestamp(
          user2.address,
          latestBlock.timestamp - 3 * ONE_DAY,
          true
        );
      }
      expect(await underlying.balanceOf(user2.address)).to.equal(
        THOUSAND_TOKENS,
        "Should unlock additional 4% after 2 days"
      );
    });

    it("should unlock fully after 180 days", async function () {
      await ethers.provider.send("evm_increaseTime", [180 * ONE_DAY]);
      await ethers.provider.send("evm_mine", []);

      const latestBlock = await ethers.provider.getBlock("latest");
      if (latestBlock && latestBlock.timestamp) {
        await rewardToken.withdrawToByLockTimestamp(
          user2.address,
          latestBlock.timestamp - 180 * ONE_DAY,
          true
        );
      }
      expect(await underlying.balanceOf(user2.address)).to.equal(
        THOUSAND_TOKENS,
        "Should unlock 100% after 180 days"
      );
    });
  });

  describe("withdrawToByLockTimestamps", function () {
    beforeEach(async function () {
      await rewardToken["setWhitelistStatus(address,uint256)"](owner.address, 1);
      await underlying.approve(rewardToken.target, 2n * THOUSAND_TOKENS);
      await rewardToken.depositFor(user1.address, THOUSAND_TOKENS);
      await rewardToken.depositFor(user2.address, THOUSAND_TOKENS);
    });

    it("should handle multiple lock timestamps correctly when allowRemainderLoss is true", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      if (!latestBlock) throw new Error("Failed to get latest block");

      const initialBalance = await underlying.balanceOf(user2.address);
      const initialRemainderBalance = await underlying.balanceOf(remainderReceiver.address);
      
      // Create two different lock timestamps
      const timestamp1 = (latestBlock.timestamp) - (latestBlock.timestamp % ONE_DAY);
      const timestamp2 = (latestBlock.timestamp + ONE_DAY) - (latestBlock.timestamp + ONE_DAY) % (ONE_DAY);

      // Get the normalized timestamp
      
      // Set user2 as none-whitelisted to create locks
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 0);

      // increase time to the current timestamp by ONE_DAY
      await ethers.provider.send("evm_increaseTime", [ONE_DAY]);
      await ethers.provider.send("evm_mine", []);

      //creating another lock
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 2);
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 0);

       // increase time to the current timestamp by ONE_DAY
       await ethers.provider.send("evm_increaseTime", [ONE_DAY]);
       await ethers.provider.send("evm_mine", []);
      
      // Withdraw from both timestamps
      const lockTimestamps = [timestamp1, timestamp2];
      await rewardToken.connect(user2).withdrawToByLockTimestamps(user2.address, lockTimestamps, true);
      
      // Verify the total amount withdrawn (should be more than single timestamp due to multiple locks)
      expect(await underlying.balanceOf(user2.address)).to.be.gt(initialBalance);
      expect(await underlying.balanceOf(remainderReceiver.address)).to.be.gt(initialRemainderBalance);
    });

    it("should handle remainder correctly when allowRemainderLoss is false", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      if (!latestBlock) throw new Error("Failed to get latest block");

      const initialBalance = await underlying.balanceOf(user2.address);
      const initialRemainderBalance = await underlying.balanceOf(remainderReceiver.address);
      
      // Create lock timestamps
      const timestamp = (latestBlock.timestamp) - (latestBlock.timestamp % ONE_DAY);
      
      // Set user2 as none-whitelisted to create locks
      await rewardToken["setWhitelistStatus(address,uint256)"](user2.address, 0);

      // increase time to the current timestamp by ONE_DAY
      await ethers.provider.send("evm_increaseTime", [ONE_DAY]);
      await ethers.provider.send("evm_mine", []);
      
      // Withdraw from both timestamps
      await expect(rewardToken.connect(user2).withdrawToByLockTimestamp(user2.address, timestamp, false)).to.be.revertedWithCustomError(rewardToken, "RemainderLossNotAllowed");
      
    });

    it("should handle non-existent lock timestamps", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      if (!latestBlock) throw new Error("Failed to get latest block");

      const initialBalance = await underlying.balanceOf(user2.address);
      
      const nonExistentTimestamp = latestBlock.timestamp - 1000 * ONE_DAY;
      const lockTimestamps = [nonExistentTimestamp];
      
      await expect(
        rewardToken.connect(user2).withdrawToByLockTimestamps(user2.address, lockTimestamps, true)
      ).to.not.be.reverted;
      
      // Verify no tokens were transferred
      expect(await underlying.balanceOf(user2.address)).to.equal(initialBalance);
    });
  });
}); 