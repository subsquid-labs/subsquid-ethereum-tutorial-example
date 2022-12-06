import { Store, TypeormDatabase } from "@subsquid/typeorm-store";
import { EvmBatchProcessor, BlockHandlerContext, LogHandlerContext } from "@subsquid/evm-processor";
import { In } from "typeorm";
import { BigNumber } from "ethers";
import {
  contractAddress,
  getOrCreateContractEntity,
} from "./contract";
import { Owner, Token, Transfer } from "./model";
import { events } from "./abi/exo";
import { Multicall } from "./abi/multicall";
import { functions } from "./abi/exo";
import { chunk, maxBy } from 'lodash'
import  assert from "assert";

const database = new TypeormDatabase();
const processor = new EvmBatchProcessor()
  .setBlockRange({ from: 15584000 })
  .setDataSource({
    chain: process.env.RPC_ENDPOINT,
    archive: 'https://eth.archive.subsquid.io',
  })
  .addLog(contractAddress, {
    filter: [[events.Transfer.topic]],
    data: {
      evmLog: {
        topics: true,
        data: true,
      },
      transaction: {
        hash: true,
      },
    },
  });

processor.run(database, async (ctx) => {
  const transfersData: TransferData[] = [];

  for (const block of ctx.blocks) {
    for (const item of block.items) {
      if (item.kind === "evmLog") {
        if (item.address === contractAddress) {
          const transfer = handleTransfer({
            ...ctx,
            block: block.header,
            ...item,
          });

          transfersData.push(transfer);
        }
      }
    }
  }

  ctx.log.info(`Saving ${transfersData.length} transfers`)
  await saveTransfers({
    ...ctx,
    block: ctx.blocks[ctx.blocks.length - 1].header,
  }, transfersData);
});

type TransferData = {
  id: string;
  from: string;
  to: string;
  tokenId: bigint;
  timestamp: bigint;
  block: number;
  transactionHash: string;
};

function handleTransfer(
  ctx: LogHandlerContext<
    Store,
    { evmLog: { topics: true; data: true }; transaction: { hash: true } }
  >
): TransferData {
  const { evmLog, transaction, block } = ctx;
  const addr = evmLog.address.toLowerCase()

  const { from, to, tokenId } = events.Transfer.decode(evmLog);

  const transfer: TransferData = {
    id: `${transaction.hash}-${addr}-${tokenId.toBigInt()}-${evmLog.index}`,
    tokenId: tokenId.toBigInt(),
    from,
    to,
    timestamp: BigInt(block.timestamp),
    block: block.height,
    transactionHash: transaction.hash,
  };

  return transfer;
}

async function saveTransfers(ctx: BlockHandlerContext<Store>, transfersData: TransferData[]) {
  const tokensIds: Set<string> = new Set();
  const ownersIds: Set<string> = new Set();

  for (const transferData of transfersData) {
    tokensIds.add(transferData.tokenId.toString());
    ownersIds.add(transferData.from);
    ownersIds.add(transferData.to);
  }

  const transfers: Set<Transfer> = new Set();

  const tokens: Map<string, Token> = new Map(
    (await ctx.store.findBy(Token, { id: In([...tokensIds]) })).map((token) => [
      token.id,
      token,
    ])
  );

  const owners: Map<string, Owner> = new Map(
    (await ctx.store.findBy(Owner, { id: In([...ownersIds]) })).map((owner) => [
      owner.id,
      owner,
    ])
  );
  
  for (const transferData of transfersData) {
    // const contract = new Contract(
    //   ctx,
    //   { height: transferData.block },
    //   contractAddress
    // );

    let from = owners.get(transferData.from);
    if (from == null) {
      from = new Owner({ id: transferData.from, balance: 0n });
      owners.set(from.id, from);
    }

    let to = owners.get(transferData.to);
    if (to == null) {
      to = new Owner({ id: transferData.to, balance: 0n });
      owners.set(to.id, to);
    }

    const tokenIdString = transferData.tokenId.toString();

    let token = tokens.get(tokenIdString);

    if (token == null) {
      token = new Token({
        id: tokenIdString,
        //uri: to be set later 
        contract: await getOrCreateContractEntity(ctx.store),
      });
      tokens.set(token.id, token);
    }
    token.owner = to;

    const { id, block, transactionHash, timestamp } = transferData;

    const transfer = new Transfer({
      id,
      block,
      timestamp,
      transactionHash,
      from,
      to,
      token,
    });

    transfers.add(transfer);
  }

  const promises: Promise<unknown>[] = []

  async function extractURIs(transferDataChunk: TransferData[]) {
    assert(transferDataChunk.length > 0)
    const maxHeight = maxBy(transferDataChunk, t => t.block)!.block; 
    // query the multicall contract at the max height of the chunk
    const multicall = new Multicall(ctx, {height: maxHeight}, '0x5ba1e12693dc8f9c48aad8770482f4739beed696')
  
    const results = await multicall.tryAggregate(functions.tokenURI, transferDataChunk.map(t => [contractAddress, [BigNumber.from(t.tokenId)]]));

    results.forEach((res, i) => {
      let t = tokens.get(transferDataChunk[i].tokenId.toString());
      if (t) {
        let uri = '';
        if (res.success) {
          uri = <string>res.value;
        } else if (res.returnData) {
          uri = <string>functions.tokenURI.tryDecodeResult(res.returnData) || '';
        }
        ctx.log.info(`Decododed URI: ${uri} for ID: ${t.id}`);
      }
    });
  }

  // split into smaller chunks to make sure the multicall call data fits into the limits
  const chunks = chunk(transfersData, 100)
  for (let i=0; i < chunks.length; i++) {
    promises.push(extractURIs(chunks[i]))
  }

  await Promise.all(promises)
  
  await ctx.store.save([...owners.values()]);
  await ctx.store.save([...tokens.values()]);
  await ctx.store.save([...transfers]);

}

