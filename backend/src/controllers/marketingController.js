import BannerMarketing from "../models/BannerMarketing.js";
import MaterialMarketing from "../models/MaterialMarketing.js";
import Usuario from "../models/Usuario.js";
import { escapeRegex } from "../utils/materialMarketingValidation.js";
import { sendServerError } from "../utils/validation.js";

const MATERIAL_SUMMARY_FIELDS =
  "_id titulo categoria imagemCapaUrl linkExterno dataPublicacao createdAt";

const sendMarketingError = (res, error, operation) => {
  console.error(`[marketing] Falha em ${operation}`, {
    name: error?.name,
    code: error?.code,
  });
  return sendServerError(res);
};

export const listarDistribuidoresMarketing = async (req, res) => {
  try {
    const busca = typeof req.query?.busca === "string"
      ? req.query.busca.trim()
      : "";

    if (busca.length > 120) {
      return res.status(400).json({ message: "Busca inválida" });
    }

    const filter = {
      tipo: "cliente",
      ativo: true,
      statusCadastro: "aprovado",
    };

    if (busca) {
      const regex = new RegExp(escapeRegex(busca), "i");
      filter.$or = [
        { nomeResponsavel: regex },
        { nomeFantasia: regex },
        { razaoSocial: regex },
      ];
    }

    const distribuidores = await Usuario.find(filter)
      .select("_id nomeResponsavel nomeFantasia razaoSocial")
      .sort({ nomeFantasia: 1, nomeResponsavel: 1, _id: 1 })
      .limit(500)
      .lean()
      .maxTimeMS(5000);

    return res.status(200).json({ distribuidores });
  } catch (error) {
    return sendMarketingError(res, error, "listar distribuidores");
  }
};

export const obterDashboardMarketing = async (req, res) => {
  try {
    const now = new Date();
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
    const inicioProximoMes = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      conteudosAtivos,
      bannersAtivos,
      publicadosNoMes,
      totalConteudos,
      conteudoRecente,
    ] = await Promise.all([
      MaterialMarketing.countDocuments({ ativo: true }).maxTimeMS(5000),
      BannerMarketing.countDocuments({ ativo: true }).maxTimeMS(5000),
      MaterialMarketing.countDocuments({
        dataPublicacao: { $gte: inicioMes, $lt: inicioProximoMes, $lte: now },
      }).maxTimeMS(5000),
      MaterialMarketing.countDocuments({}).maxTimeMS(5000),
      MaterialMarketing.findOne({ dataPublicacao: { $lte: now } })
        .select(MATERIAL_SUMMARY_FIELDS)
        .sort({ dataPublicacao: -1, createdAt: -1, _id: -1 })
        .lean()
        .maxTimeMS(5000),
    ]);

    return res.status(200).json({
      metricas: {
        conteudosAtivos,
        bannersAtivos,
        publicadosNoMes,
        totalConteudos,
      },
      conteudoRecente,
    });
  } catch (error) {
    return sendMarketingError(res, error, "carregar dashboard");
  }
};
