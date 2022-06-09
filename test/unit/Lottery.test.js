const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

// Unit tests on development chains
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery", function () {
          let lottery, vrfCoordinatorV2Mock, lotteryEntranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              lottery = await ethers.getContract("Lottery", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              lotteryEntranceFee = await lottery.getEntranceFee()
              interval = await lottery.getInterval()
          })

          describe("constructor", function () {
              it("initializes the lottery correctly", async function () {
                  // Ideally we make our tests have just 1 assert per "it"
                  // But we can be a bit loose here
                  const lotteryState = await lottery.getLotteryState()
                  const interval = await lottery.getInterval()
                  assert.equal(lotteryState.toString(), "0") // OPEN
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterLottery", function () {
              it("reverts when you don't pay enough", async function () {
                  await expect(lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__NotEnoughETHEntered"
                  )
              })

              it("records players when they enter", async function () {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  const playerFromContract = await lottery.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })

              it("emits event on enter", async function () {
                  await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.emit(
                      lottery,
                      "LotteryEnter"
                  )
              })
              it("doesn't allow entrance when lottery is not open", async function () {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  // Pretend to be a Chainlink Keeper
                  await lottery.performUpkeep([])
                  // lottery is now in a calculating state
                  await expect(
                      lottery.enterLottery({ value: lotteryEntranceFee })
                  ).to.be.revertedWith("Lottery__NotOpen")
              })
          })

          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  // callstatic: simulate calling the transaction
                  // and see what it would respond with
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })
              it("returns false if lottery isn't open", async function () {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await lottery.performUpkeep("0x")
                  const lotteryState = await lottery.getLotteryState()
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                  assert.equal(lotteryState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x")
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x")
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("it can only run if checkUpkeep is true", async function () {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await lottery.performUpkeep([])
                  assert(tx)
              })

              it("reverts when checkUpkeep is false", async function () {
                  await expect(lottery.performUpkeep([])).to.be.revertedWith(
                      "Lottery__UpkeepNotNeeded" // can test for specific values
                  )
              })

              it("updates the lottery state, emits an event, and calls the vrf coordinator", async function () {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await lottery.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const lotteryState = await lottery.getLotteryState()
                  assert(requestId.toNumber() > 0)
                  assert(lotteryState.toString() == "1")
              })
          })

          describe("fullfillRandomWords", function () {
              // want someone to enter lottery before testing
              beforeEach(async function () {
                  await lottery.enterLottery({ value: lotteryEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })

              it("can only be called after performingUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)
                  ).to.be.revertedWith("nonexistent request")
              })

              // This test is way too big, split it up later
              it("picks a winner, resets the lottery, and sends money", async function () {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1 // deployer = 0
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedLottery = lottery.connect(accounts[i])
                      await accountConnectedLottery.enterLottery({ value: lotteryEntranceFee })
                  }
                  const startingTimeStamp = await lottery.getLatestTimeStamp()

                  // performUpkeep (mock being the Chainlink Keeper)
                  // fulfillRandomWords (mock being the Chainlink VRF)
                  // We will have to wait for the fulfillRandomWords to be called on a testnet
                  await new Promise(async (resolve, reject) => {
                      // set up a listener
                      lottery.once("WinnerPicked", async () => {
                          try {
                              const recentWinner = await lottery.getRecentWinner()
                              assert.equal(recentWinner, accounts[1].address)
                              const winnerEndingBalance = await accounts[1].getBalance()
                              const lotteryState = await lottery.getLotteryState()
                              const endingTimeStamp = await lottery.getLatestTimeStamp()
                              const numPlayers = await lottery.getNumberOfPlayers()

                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(lotteryState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      lotteryEntranceFee
                                          .mul(additionalEntrants)
                                          .add(lotteryEntranceFee)
                                          .toString()
                                  )
                              )
                          } catch (error) {
                              reject(error)
                          }
                          resolve()
                      })
                      // Below, we fire the event, and the listener will pick it up
                      const tx = await lottery.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          lottery.address
                      )
                  })
              })
          })
      })
