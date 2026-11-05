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
    import("../models/OperadorLogistica.js"),
    import("../models/MaterialMarketing.js"),
    import("../models/BannerMarketing.js"),
    import("../models/Treinamento.js"),
    import("../models/ProgressoTreinamento.js"),
    import("../models/NatalLote.js"),
    import("../models/NatalParticipacao.js"),
    import("../models/NatalCupom.js"),
    import("../models/NatalAuditoria.js"),
    import("../models/NatalConta.js"),
    import("../models/NatalMovimentoCupom.js"),
    import("../models/NatalBonificacao.js"),
    import("../models/NatalCompraExterna.js"),
    import("../models/NatalMigracaoExecucao.js"),
    import("../models/NatalSubstituicaoCompra.js"),
  ]);
  const { NatalExportacao } = await import("../models/NatalCampanhaEstado.js");

  for (const model of [...models.map((module) => module.default), NatalExportacao]) {
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
