import { Store } from "@subsquid/typeorm-store";
import { Contract } from "./model";

// see https://github.com/makerdao/multicall
export const MULTICALL_ADDRESS='0x5ba1e12693dc8f9c48aad8770482f4739beed696'
export const EXOSAMA_NFT_CONTRACT = '0xac5c7493036de60e63eb81c5e9a440b42f47ebf5';

let contractEntity: Contract | undefined;

export async function getOrCreateContractEntity(store: Store): Promise<Contract> {
  if (contractEntity == null) {
    contractEntity = await store.get(Contract, EXOSAMA_NFT_CONTRACT);
    if (contractEntity == null) {
      contractEntity = new Contract({
        id: EXOSAMA_NFT_CONTRACT,
        name: "Exosama",
        symbol: "EXO",
        totalSupply: 10000n,
      });
      await store.insert(contractEntity);
    }
  }
  return contractEntity;
}