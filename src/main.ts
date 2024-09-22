import * as crypto from 'crypto'
import {run} from '@subsquid/batch-processor'
import {augmentBlock} from '@subsquid/fuel-objects'
import {DataSourceBuilder} from '@subsquid/fuel-stream'
import {TypeormDatabase} from '@subsquid/typeorm-store'
import {Asset} from './model'
import { Interface } from 'fuels'
import src20Abi from './abis/src20-abi.json'

const setNameEventId = 7845998088195677205n;
const setSymbolEventId = 12152039456660331088n;
const setDecimalsEventId = 18149631459970394923n;

const src20Interface = new Interface(src20Abi);

function getAssetId(contractId: string, subId: string): string {
    return '0x' + crypto
        .createHash('sha256')
        .update(Buffer.from(contractId.slice(2) + subId.slice(2), 'hex'))
        .digest('hex');
}


// First we create a DataSource - the component that
// defines what data we need and where to get it
const dataSource = new DataSourceBuilder()
    // Provide a Subsquid Network Gateway URL
    .setGateway('https://v2.archive.subsquid.io/network/fuel-testnet')
    // Subsquid Network is always about 10000 blocks behind the head.
    // We must use a regular GraphQL endpoint to get through
    // the last mile and stay on top of the chain.
    // This is a limitation, and we promise to lift it in the future!
    .setGraphql({
        url: 'https://testnet.fuel.network/v1/graphql',
        strideConcurrency: 3,
        strideSize: 50
    })
    .setFields({
        receipt: {
            contract: true,
            receiptType: true,
            data: true,
            rb: true,
            assetId: true,
            subId: true,
        }
    })
    .addReceipt({
        type: ['LOG_DATA', 'MINT']
    })
    .build()

// Once we've prepared a data source we can start fetching the data right away:
//
// for await (let batch of dataSource.getBlockStream()) {
//     for (let block of batch) {
//         console.log(block)
//     }
// }
//
// However, Subsquid SDK can also help to transform and persist the data.

// Data processing in Subsquid SDK is defined by four components:
//
//  1. Data source (such as we've created above)
//  2. Database
//  3. Data handler
//  4. Processor
//
// Database is responsible for persisting the work progress (last processed block)
// and for providing storage API to the data handler.
//
// Data handler is a user defined function which accepts consecutive block batches,
// storage API and is responsible for entire data transformation.
//
// Processor connects and executes above three components.

// Below we create a `TypeormDatabase`.
//
// It provides restricted subset of [TypeORM EntityManager API](https://typeorm.io/working-with-entity-manager)
// as a persistent storage interface and works with any Postgres-compatible database.
//
// Note, that we don't pass any database connection parameters.
// That's because `TypeormDatabase` expects a certain project structure
// and environment variables to pick everything it needs by convention.
// Companion `@subsquid/typeorm-migration` tool works in the same way.
//
// For full configuration details please consult
// https://github.com/subsquid/squid-sdk/blob/278195bd5a5ed0a9e24bfb99ee7bbb86ff94ccb3/typeorm/typeorm-config/src/config.ts#L21
const database = new TypeormDatabase()

// Now we are ready to start processing the data
run(dataSource, database, async ctx => {
    // Block items that we get from `ctx.blocks` are flat JS objects.
    //
    // We can use `augmentBlock()` function from `@subsquid/fuel-objects`
    // to enrich block items with references to related objects.
    let blocks = ctx.blocks.map(augmentBlock)

    const assetsById: Record<string, Asset> = {};

    const getAsset = async (assetId: string) => {
        let asset: Asset | undefined = assetsById[assetId];
        if (!asset) {
            asset = await ctx.store.findOne(Asset, {where: { id: assetId }});
        }
        if (!asset) {
            asset = new Asset({ id: assetId });
        }
        assetsById[assetId] = asset;
        return asset;
    }

    for (let block of blocks) {
        for (let receipt of block.receipts) {
            if (receipt.receiptType == 'MINT') {
                const assetId = getAssetId(receipt.contract!, receipt.subId!);
                const mintedAsset = await getAsset(assetId);
                mintedAsset.contractId = receipt.contract;
                mintedAsset.subId = receipt.subId;
            }

            if (receipt.receiptType == 'LOG_DATA') {
                switch (receipt.rb) {
                    case setNameEventId:
                        const [nameEvent] = src20Interface.decodeLog(receipt.data!, setNameEventId.toString());
                        console.log(nameEvent);
                        const nameAsset = await getAsset(nameEvent.asset.bits);
                        nameAsset.name = nameEvent.name;
                        break;
                    case setSymbolEventId:
                        const [symbolEvent] = src20Interface.decodeLog(receipt.data!, setSymbolEventId.toString());
                        const symbolAsset = await getAsset(symbolEvent.asset.bits);
                        symbolAsset.symbol = symbolEvent.symbol;
                        break;
                    case setDecimalsEventId:
                        const [decimalsEvent] = src20Interface.decodeLog(receipt.data!, setDecimalsEventId.toString());
                        const decimalsAsset = await getAsset(decimalsEvent.asset.bits);
                        decimalsAsset.decimals = decimalsEvent.decimals;
                        break;
                }
            }
        }
    }
    ctx.store.upsert(Object.values(assetsById));
})
