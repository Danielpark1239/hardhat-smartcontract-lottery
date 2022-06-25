const { ethers, network } = require("hardhat")
const fs = require("fs")
const FRONTEND_ADDRESSES_FILE = "../nextjs-smartcontract-lottery/constants/contractAddresses.json"
const FRONTEND_ABI_FILE = "../nextjs-smartcontract-lottery/constants/abi.json"

module.exports = async function () {
    if (process.env.UPDATE_FRONTEND) {
        console.log("updating frontend...")
        await updateContractAddresses()
        await updateAbi()
        console.log("frontend updated!")
    }
}

async function updateContractAddresses() {
    const lottery = await ethers.getContract("Lottery")
    const chainId = network.config.chainId.toString()
    const contractAddresses = JSON.parse(fs.readFileSync(FRONTEND_ADDRESSES_FILE, "utf8"))
    // frontend has chainId
    if (chainId in contractAddresses) {
        // update if contract address is different
        if (!contractAddresses[chainId].includes(lottery.address)) {
            contractAddresses[chainId] = [lottery.address] // just using one for now
        }
    }
    // frontend doesn't have chainId
    else {
        contractAddresses[chainId] = [lottery.address]
    }
    fs.writeFileSync(FRONTEND_ADDRESSES_FILE, JSON.stringify(contractAddresses))
}

async function updateAbi() {
    const lottery = await ethers.getContract("Lottery")
    fs.writeFileSync(FRONTEND_ABI_FILE, lottery.interface.format(ethers.utils.FormatTypes.json))
}

module.exports.tags = ["all", "frontend"]
