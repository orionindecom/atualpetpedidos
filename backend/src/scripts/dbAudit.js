import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ quiet: true });

const collections = [
  "usuarios",
  "produtos",
  "tabelaprecos",
  "precoprodutos",
  "pedidos",
  "materiaismarketing",
  "treinamentos",
  "progressostreinamentos",
];

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI não configurada");
  }

  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);

  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
    autoCreate: false,
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });

  const existingCollections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const existingNames = new Set(existingCollections.map(({ name }) => name));

  for (const collectionName of collections) {
    if (!existingNames.has(collectionName)) {
      console.log(`${collectionName}: coleção ausente`);
      continue;
    }

    const collection = mongoose.connection.db.collection(collectionName);
    const [count, indexes] = await Promise.all([
      collection.estimatedDocumentCount(),
      collection.listIndexes().toArray(),
    ]);

    console.log(
      `${collectionName}: documentos=${count}; índices=${indexes
        .map(({ name }) => name)
        .join(",")}`
    );
  }

  if (existingNames.has("precoprodutos")) {
    const duplicates = await mongoose.connection.db
      .collection("precoprodutos")
      .aggregate(
        [
          {
            $group: {
              _id: {
                tabelaPrecoId: "$tabelaPrecoId",
                produtoId: "$produtoId",
              },
              quantidade: { $sum: 1 },
            },
          },
          { $match: { quantidade: { $gt: 1 } } },
          { $limit: 10 },
          { $count: "grupos" },
        ],
        { allowDiskUse: true, maxTimeMS: 10000 }
      )
      .toArray();

    console.log(
      `precoprodutos: grupos duplicados (máximo inspecionado 10)=${
        duplicates[0]?.grupos || 0
      }`
    );
  }
};

run()
  .catch(() => {
    console.error("Falha ao auditar índices do MongoDB");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
