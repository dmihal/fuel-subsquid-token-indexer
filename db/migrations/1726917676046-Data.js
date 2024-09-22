module.exports = class Data1726917676046 {
    name = 'Data1726917676046'

    async up(db) {
        await db.query(`CREATE TABLE "asset" ("id" character varying NOT NULL, "contract_id" text, "sub_id" text, "name" text, "symbol" text, "decimals" integer, CONSTRAINT "PK_1209d107fe21482beaea51b745e" PRIMARY KEY ("id"))`)
    }

    async down(db) {
        await db.query(`DROP TABLE "asset"`)
    }
}
