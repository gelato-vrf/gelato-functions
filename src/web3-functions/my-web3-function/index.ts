import {
    Web3Function,
    Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { utils, ethers } from "ethers";
import { fetchBeacon, HttpChainClient, HttpCachingChain } from "drand-client"



const AD_BOARD_ABI = [
    "function setRandom(uint256)",
];

Web3Function.onRun(async (context: Web3FunctionContext) => {
    const { storage, gelatoArgs } = context;

    const lastPost = Number(await storage.get("lastPost")) ?? 0;
    const adBoardInterface = new utils.Interface(AD_BOARD_ABI);


    const nextPostTime = lastPost + 30; // 1h
    const timestamp = gelatoArgs.blockTime;

    if (timestamp < nextPostTime) {
        return { canExec: false, message: `Time not elapsed` };
    }

    const chainHash = '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce' // (hex encoded)
    const publicKey = '868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31' // (hex encoded)


    const options = {
        // TODO : correct the code and set to false for verifiable randomness
        disableBeaconVerification: true, // `true` disables checking of signatures on beacons - faster but insecure!!!
        noCache: false, // `true` disables caching when retrieving beacons for some providers
        chainVerificationParams: { chainHash, publicKey }  // these are optional, but recommended! They are compared for parity against the `/info` output of a given node
    }

    const chain = new HttpCachingChain('https://drand.cloudflare.com', options)
    const client = new HttpChainClient(chain, options)


    let num

    try {
        const theLatestBeacon = await fetchBeacon(client);
        const hexNum = theLatestBeacon.randomness
        console.log(hexNum)
        const stringWithPrefix = "0x" + hexNum;
        num = ethers.BigNumber.from(stringWithPrefix);
        console.log(num)
    } catch (err) {
        console.log(err)
        return { canExec: false, message: `QuoteApi call failed` };
    }


    await storage.set("lastPost", timestamp.toString());

    return {
        canExec: true,
        callData: adBoardInterface.encodeFunctionData("setRandom", [num]),
    };
});