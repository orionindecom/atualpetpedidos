import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ quiet: true });

const run = async () => {
  if (process.env.CONFIRM_INDEX_CREATION !== "true") {
    throw new Error(
      "Operação bloqueada. Defina CONFIRM_INDEX_CREATION=true após revisar o Atlas."
    );
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI não configurada");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
  });

  const models = await Promise.all([
    import("../models/Usuario.js"),
    import("../models/Produto.js"),
    import("../models/TabelaPreco.js"),
    import("../models/PrecoProduto.js"),
    import("../models/Pedido.js"),
    import("../models/MaterialMarketing.js"),
    import("../models/Treinamento.js"),
    import("../models/ProgressoTreinamento.js"),
  ]);

  for (const { default: model } of models) {
    await model.createIndexes();
    console.log(`${model.modelName}: índices verificados`);
  }
};

run()
  .catch((error) => {
    console.error(error.message || "Falha ao criar índices");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
