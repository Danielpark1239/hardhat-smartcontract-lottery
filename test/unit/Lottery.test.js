const { assert } = require("chai")
const { getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

// Unit tests on development chains
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery", async function () {
          let lottery, vrfCoordinatorV2Mock

          beforeEach(async function () {
              const { deployer } = await getNamedAccounts()
              await deployments.fixture(["all"])
              lottery = await ethers.getContract("Lottery", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
          })

          describe("constructor", async function () {
              it("initializes the lottery correctly", async function () {
                  // Ideally we make our tests have just 1 assert per "it"
                  // But we can be a bit loose here
                  const lotteryState = await lottery.getLotteryState()
                  assert.equal(lotteryState.toString())
              })
          })
      })
