import {
    Web3Function,
    Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { utils, ethers } from "ethers";
import {
    HttpChainClient,
    HttpCachingChain,
    G2ChainedBeacon,
    ChainInfo,
    isChainedBeacon,
    isUnchainedBeacon,
    RandomnessBeacon,
    G2UnchainedBeacon,
    isG1G2SwappedBeacon,
    G1UnchainedBeacon
} from "drand-client"
import { Buffer } from "buffer"; // needs to be imported manually to work with gelato w3f
import * as bls from '@noble/bls12-381' // drand-client uses this dependency, but it is deprecated
import { PointG1, PointG2, Fp12, pairing } from '@noble/bls12-381';

//import * as bls from '@noble/curves/bls12-381' // this is the upgrade of drand-clients deprecated dependency
//it works diferently and is not compatible with the code below



const AD_BOARD_ABI = [
    "function setRandom(uint256)",
];

Web3Function.onRun(async (context: Web3FunctionContext) => {
    const { storage, gelatoArgs } = context;

    const lastPost = Number(await storage.get("lastPost")) ?? 0;
    const adBoardInterface = new utils.Interface(AD_BOARD_ABI);


    const nextPostTime = lastPost + 30;
    const timestamp = gelatoArgs.blockTime;

    if (timestamp < nextPostTime) {
        return { canExec: false, message: `Time not elapsed` };
    }

    const chainHash = '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce' // (hex encoded)
    const publicKey = '868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31' // (hex encoded)


    const options = {
        disableBeaconVerification: false, // `true` disables checking of signatures on beacons - faster but insecure!!!
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

// define fetchBeacon and dependent functions since import is not working
async function fetchBeacon(client: HttpChainClient): Promise<RandomnessBeacon> {
    let beacon = await client.latest()
    return validatedBeacon(client, beacon)
}

// drand-client/lib/beacon-verification.ts
async function validatedBeacon(client: HttpChainClient, beacon: RandomnessBeacon): Promise<RandomnessBeacon> {
    if (client.options.disableBeaconVerification) {
        return beacon
    }
    const info = await client.chain().info()
    if (!await verifyBeacon(info, beacon)) {
        throw Error('The beacon retrieved was not valid!')
    }

    return beacon
}

async function verifyBeacon(chainInfo: ChainInfo, beacon: RandomnessBeacon): Promise<boolean> {
    const publicKey = chainInfo.public_key

    if (!await randomnessIsValid(beacon)) {
        return false
    }

    if (isChainedBeacon(beacon, chainInfo)) {
        return bls.verify(beacon.signature, await chainedBeaconMessage(beacon), publicKey)
    }

    if (isUnchainedBeacon(beacon, chainInfo)) {
        return bls.verify(beacon.signature, await unchainedBeaconMessage(beacon), publicKey)
    }

    if (isG1G2SwappedBeacon(beacon, chainInfo)) {
        return verifySigOnG1(beacon.signature, await unchainedBeaconMessage(beacon), publicKey)
    }

    console.error(`Beacon type ${chainInfo.schemeID} was not supported`)
    return false

}

// @noble/bls12-381 does everything on G2, so we've implemented a manual verification for beacons on G1
type G1Hex = Uint8Array | string | PointG1;
type G2Hex = Uint8Array | string | PointG2;

function normP1(point: G1Hex): PointG1 {
    return point instanceof PointG1 ? point : PointG1.fromHex(point);
}

function normP2(point: G2Hex): PointG2 {
    return point instanceof PointG2 ? point : PointG2.fromHex(point);
}

async function normP1Hash(point: G1Hex): Promise<PointG1> {
    return point instanceof PointG1 ? point : PointG1.hashToCurve(point);
}

export async function verifySigOnG1(signature: G1Hex, message: G1Hex, publicKey: G2Hex): Promise<boolean> {
    const P = normP2(publicKey);
    const Hm = await normP1Hash(message);
    const G = PointG2.BASE;
    const S = normP1(signature);
    const ePHm = pairing(Hm, P.negate(), false);
    const eGS = pairing(S, G, false);
    const exp = eGS.multiply(ePHm).finalExponentiate();
    return exp.equals(Fp12.ONE);
}

async function chainedBeaconMessage(beacon: G2ChainedBeacon): Promise<Uint8Array> {
    const message = Buffer.concat([
        signatureBuffer(beacon.previous_signature),
        roundBuffer(beacon.round)
    ])

    return bls.utils.sha256(message)
}

async function unchainedBeaconMessage(beacon: G2UnchainedBeacon | G1UnchainedBeacon): Promise<Uint8Array> {
    return bls.utils.sha256(roundBuffer(beacon.round))
}

function signatureBuffer(sig: string) {
    return Buffer.from(sig, 'hex')
}

function roundBuffer(round: number) {
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64BE(BigInt(round))
    return buffer
}

async function randomnessIsValid(beacon: RandomnessBeacon): Promise<boolean> {
    const expectedRandomness = await bls.utils.sha256(Buffer.from(beacon.signature, 'hex'))
    return Buffer.from(beacon.randomness, 'hex').compare(expectedRandomness) == 0
}