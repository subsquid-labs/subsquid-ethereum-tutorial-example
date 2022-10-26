import { Store } from "@subsquid/typeorm-store";
import { Contract } from "./model";

export const CHAIN_NODE = 'wss://mainnet.infura.io/ws/v3/2a1be98f319e4b059b85f853a140b315'; // 'ws://195.201.56.33:8545'; 

export const contractAddress = "0xac5c7493036de60e63eb81c5e9a440b42f47ebf5";

let contractEntity: Contract | undefined;

export async function getOrCreateContractEntity(store: Store): Promise<Contract> {
  if (contractEntity == null) {
    contractEntity = await store.get(Contract, contractAddress);
    if (contractEntity == null) {
      contractEntity = new Contract({
        id: contractAddress,
        name: "Exosama",
        symbol: "EXO",
        totalSupply: 10000n,
      });
      await store.insert(contractEntity);
    }
  }
  return contractEntity;
}