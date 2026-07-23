import mongoose from "mongoose";
import Treinamento from "../models/Treinamento.js";
import ProgressoTreinamento from "../models/ProgressoTreinamento.js";
import {
  buildTrainingFilter,
  parseTrainingQuery,
  TRAINING_SORT,
  validateProgressPayload,
  validateTrainingPayload,
} from "../utils/trainingValidation.js";
import {
  deleteImageByPublicId,
  ImageUploadError,
  uploadImageBufferDetails,
} from "../utils/cloudinaryUpload.js";
import { sendServerError } from "../utils/validation.js";

const MAX_QUERY_TIME_MS = 5000;
const TRAINING_IMAGE_FOLDER = "atualpet/treinamentos";
const CLIENT_DETAIL_FIELDS =
  "_id titulo descricao resumo categoria marca linha instrutor duracaoSegundos provider videoId thumbnailUrl destaque obrigatorio publicadoEm";

const emptyProgress = {
  ultimaPosicaoSegundos: 0,
  percentualAssistido: 0,
  concluido: false,
  ultimoAcessoEm: null,
};

const sendValidationError = (res, errors) =>
  res.status(400).json({
    message: "Revise os dados do treinamento",
    errors,
  });

const sanitizeTraining = (training) => {
  const safe = training?.toObject
    ? training.toObject()
    : { ...training };
  delete safe.thumbnailPublicId;
  return safe;
};

const isRemovalRequested = (value) => value === true || value === "true";

const uploadThumbnail = (file) => uploadImageBufferDetails(file, {
  errorMessage: "Não foi possível enviar a thumbnail do treinamento",
  folder: TRAINING_IMAGE_FOLDER,
  requirePublicId: true,
});

const removeThumbnailBestEffort = async (publicId) => {
  if (!publicId) return;

  try {
    await deleteImageByPublicId(publicId, {
      allowedFolder: TRAINING_IMAGE_FOLDER,
    });
  } catch (error) {
    console.error("[treinamentos] Falha ao limpar thumbnail", {
      name: error?.name,
      code: error?.cause?.http_code || error?.code,
    });
  }
};

const logAndSendError = (res, error, operation) => {
  console.error(`[treinamentos] Falha em ${operation}`, {
    name: error?.name,
    code: error?.code,
  });
  return sendServerError(res);
};

const handleControllerError = (res, error, operation) => {
  if (error instanceof ImageUploadError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  return logAndSendError(res, error, operation);
};

export const buildClientTrainingPipeline = ({
  filter,
  query,
  usuarioId,
}) => {
  const skip = (query.pagina - 1) * query.limite;
  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: "progressostreinamentos",
        let: { treinamentoAtual: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$treinamentoId", "$$treinamentoAtual"] },
                  { $eq: ["$usuarioId", usuarioId] },
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              ultimaPosicaoSegundos: 1,
              percentualAssistido: 1,
              concluido: 1,
              ultimoAcessoEm: 1,
            },
          },
        ],
        as: "progressoEncontrado",
      },
    },
    {
      $set: {
        progresso: {
          $ifNull: [{ $arrayElemAt: ["$progressoEncontrado", 0] }, emptyProgress],
        },
      },
    },
    {
      $set: {
        statusProgresso: {
          $switch: {
            branches: [
              { case: "$progresso.concluido", then: "concluido" },
              {
                case: { $gt: ["$progresso.percentualAssistido", 0] },
                then: "em_andamento",
              },
            ],
            default: "nao_iniciado",
          },
        },
      },
    },
  ];

  if (query.statusProgresso) {
    pipeline.push({ $match: { statusProgresso: query.statusProgresso } });
  }

  pipeline.push(
    { $sort: TRAINING_SORT },
    {
      $facet: {
        treinamentos: [
          { $skip: skip },
          { $limit: query.limite },
          {
            $project: {
              _id: 0,
              id: "$_id",
              titulo: 1,
              resumo: 1,
              categoria: 1,
              marca: 1,
              linha: 1,
              instrutor: 1,
              duracaoSegundos: 1,
              provider: 1,
              thumbnailUrl: {
                $cond: [
                  { $ne: [{ $ifNull: ["$thumbnailUrl", ""] }, ""] },
                  "$thumbnailUrl",
                  { $concat: ["https://i.ytimg.com/vi/", "$videoId", "/hqdefault.jpg"] },
                ],
              },
              destaque: 1,
              obrigatorio: 1,
              publicadoEm: 1,
              progresso: 1,
            },
          },
        ],
        total: [{ $count: "quantidade" }],
      },
    }
  );

  return pipeline;
};

export const listarTreinamentosAdmin = async (req, res) => {
  try {
    const query = parseTrainingQuery(req.query, { admin: true });
    if (!query) {
      return res.status(400).json({ message: "Parâmetros de consulta inválidos" });
    }

    const filter = buildTrainingFilter(query);
    const skip = (query.pagina - 1) * query.limite;
    const [treinamentos, totalItens, categorias, marcas, linhas] = await Promise.all([
      Treinamento.find(filter)
        .select("-__v -criadoPor -atualizadoPor -thumbnailPublicId")
        .sort(TRAINING_SORT)
        .skip(skip)
        .limit(query.limite)
        .lean()
        .maxTimeMS(MAX_QUERY_TIME_MS),
      Treinamento.countDocuments(filter).maxTimeMS(MAX_QUERY_TIME_MS),
      Treinamento.distinct("categoria"),
      Treinamento.distinct("marca"),
      Treinamento.distinct("linha"),
    ]);
    const totalPaginas = Math.ceil(totalItens / query.limite);

    return res.status(200).json({
      treinamentos,
      paginacao: {
        paginaAtual: query.pagina,
        totalPaginas,
        totalItens,
        limite: query.limite,
        temProximaPagina: query.pagina < totalPaginas,
      },
      filtros: {
        categorias: categorias.filter(Boolean).sort(),
        marcas: marcas.filter(Boolean).sort(),
        linhas: linhas.filter(Boolean).sort(),
      },
    });
  } catch (error) {
    return logAndSendError(res, error, "listar treinamentos do admin");
  }
};

export const buscarTreinamentoAdmin = async (req, res) => {
  try {
    const treinamento = await Treinamento.findById(req.params.id)
      .select("-__v -criadoPor -atualizadoPor -thumbnailPublicId")
      .lean();

    if (!treinamento) {
      return res.status(404).json({ message: "Treinamento não encontrado" });
    }

    return res.status(200).json(treinamento);
  } catch (error) {
    return logAndSendError(res, error, "buscar treinamento do admin");
  }
};

export const criarTreinamento = async (req, res) => {
  let uploadedImage = null;

  try {
    const validation = validateTrainingPayload(req.body);
    if (!validation.valid) return sendValidationError(res, validation.errors);

    if (req.file) uploadedImage = await uploadThumbnail(req.file);

    let treinamento;
    try {
      treinamento = await Treinamento.create({
        ...validation.data,
        thumbnailUrl: uploadedImage?.secureUrl || "",
        thumbnailPublicId: uploadedImage?.publicId || "",
        criadoPor: req.usuario._id,
      });
    } catch (error) {
      await removeThumbnailBestEffort(uploadedImage?.publicId);
      throw error;
    }

    return res.status(201).json({
      message: "Treinamento criado com sucesso",
      treinamento: sanitizeTraining(treinamento),
    });
  } catch (error) {
    return handleControllerError(res, error, "criar treinamento");
  }
};

export const atualizarTreinamento = async (req, res) => {
  let uploadedImage = null;

  try {
    const removalRequested = isRemovalRequested(req.body?.removerThumbnail);
    const validation = validateTrainingPayload(req.body, {
      allowEmpty: Boolean(req.file || removalRequested),
      partial: true,
    });
    if (!validation.valid) return sendValidationError(res, validation.errors);

    const treinamento = await Treinamento.findById(req.params.id);
    if (!treinamento) {
      return res.status(404).json({ message: "Treinamento não encontrado" });
    }

    const previousPublicId = treinamento.thumbnailPublicId;
    for (const [field, value] of Object.entries(validation.data)) {
      treinamento[field] = value;
    }

    if (req.file) {
      uploadedImage = await uploadThumbnail(req.file);
      treinamento.thumbnailUrl = uploadedImage.secureUrl;
      treinamento.thumbnailPublicId = uploadedImage.publicId;
    } else if (removalRequested) {
      treinamento.thumbnailUrl = "";
      treinamento.thumbnailPublicId = "";
    }

    treinamento.atualizadoPor = req.usuario._id;
    try {
      await treinamento.save();
    } catch (error) {
      await removeThumbnailBestEffort(uploadedImage?.publicId);
      throw error;
    }

    if ((uploadedImage || removalRequested) && previousPublicId) {
      await removeThumbnailBestEffort(previousPublicId);
    }

    return res.status(200).json({
      message: "Treinamento atualizado com sucesso",
      treinamento: sanitizeTraining(treinamento),
    });
  } catch (error) {
    return handleControllerError(res, error, "atualizar treinamento");
  }
};

export const alterarStatusTreinamento = async (req, res) => {
  try {
    if (typeof req.body?.ativo !== "boolean") {
      return sendValidationError(res, { ativo: "Informe verdadeiro ou falso" });
    }

    const treinamento = await Treinamento.findById(req.params.id);
    if (!treinamento) {
      return res.status(404).json({ message: "Treinamento não encontrado" });
    }

    treinamento.ativo = req.body.ativo;
    treinamento.atualizadoPor = req.usuario._id;
    await treinamento.save();

    return res.status(200).json({
      message: treinamento.ativo
        ? "Treinamento ativado com sucesso"
        : "Treinamento desativado com sucesso",
      treinamento: sanitizeTraining(treinamento),
    });
  } catch (error) {
    return logAndSendError(res, error, "alterar status do treinamento");
  }
};

export const excluirTreinamento = async (req, res) => {
  try {
    const treinamento = await Treinamento.findByIdAndDelete(req.params.id);
    if (!treinamento) {
      return res.status(404).json({ message: "Treinamento não encontrado" });
    }

    await ProgressoTreinamento.deleteMany({ treinamentoId: treinamento._id });
    await removeThumbnailBestEffort(treinamento.thumbnailPublicId);
    return res.status(200).json({ message: "Treinamento excluído com sucesso" });
  } catch (error) {
    return logAndSendError(res, error, "excluir treinamento");
  }
};

export const listarProgressoAdmin = async (req, res) => {
  try {
    const query = parseTrainingQuery(req.query, { admin: true });
    if (!query) {
      return res.status(400).json({ message: "Parâmetros de consulta inválidos" });
    }

    const treinamento = await Treinamento.findById(req.params.id)
      .select("_id titulo")
      .lean();
    if (!treinamento) {
      return res.status(404).json({ message: "Treinamento não encontrado" });
    }

    const filter = { treinamentoId: treinamento._id };
    const skip = (query.pagina - 1) * query.limite;
    const [stats, progressos, totalItens] = await Promise.all([
      ProgressoTreinamento.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            iniciaram: { $sum: 1 },
            concluiram: { $sum: { $cond: ["$concluido", 1, 0] } },
            mediaProgresso: { $avg: "$percentualAssistido" },
            ultimoAcessoEm: { $max: "$ultimoAcessoEm" },
          },
        },
      ]).option({ maxTimeMS: MAX_QUERY_TIME_MS }),
      ProgressoTreinamento.find(filter)
        .select("-_id usuarioId percentualAssistido concluido iniciadoEm ultimoAcessoEm concluidoEm")
        .populate("usuarioId", "nomeResponsavel nomeFantasia email")
        .sort({ ultimoAcessoEm: -1 })
        .skip(skip)
        .limit(query.limite)
        .lean()
        .maxTimeMS(MAX_QUERY_TIME_MS),
      ProgressoTreinamento.countDocuments(filter).maxTimeMS(MAX_QUERY_TIME_MS),
    ]);
    const summary = stats[0] || {};

    return res.status(200).json({
      treinamento,
      resumo: {
        totalIniciaram: summary.iniciaram || 0,
        totalConcluiram: summary.concluiram || 0,
        mediaProgresso: Math.round((summary.mediaProgresso || 0) * 100) / 100,
        ultimoAcessoEm: summary.ultimoAcessoEm || null,
      },
      usuarios: progressos,
      paginacao: {
        paginaAtual: query.pagina,
        totalPaginas: Math.ceil(totalItens / query.limite),
        totalItens,
        limite: query.limite,
      },
    });
  } catch (error) {
    return logAndSendError(res, error, "listar progresso administrativo");
  }
};

export const listarTreinamentosCliente = async (req, res) => {
  try {
    const query = parseTrainingQuery(req.query);
    if (!query) {
      return res.status(400).json({ message: "Parâmetros de consulta inválidos" });
    }

    const now = new Date();
    const filter = buildTrainingFilter(query, { onlyAvailable: true, now });
    const usuarioId = new mongoose.Types.ObjectId(String(req.usuario._id));
    const scope = { ativo: true, publicadoEm: { $ne: null, $lte: now } };
    const [facets, categorias, marcas, linhas] = await Promise.all([
      Treinamento.aggregate(
        buildClientTrainingPipeline({ filter, query, usuarioId })
      ).option({ maxTimeMS: MAX_QUERY_TIME_MS }),
      Treinamento.distinct("categoria", scope),
      Treinamento.distinct("marca", scope),
      Treinamento.distinct("linha", scope),
    ]);
    const result = facets[0] || { treinamentos: [], total: [] };
    const totalItens = result.total[0]?.quantidade || 0;
    const totalPaginas = Math.ceil(totalItens / query.limite);

    return res.status(200).json({
      treinamentos: result.treinamentos,
      paginacao: {
        paginaAtual: query.pagina,
        totalPaginas,
        totalItens,
        limite: query.limite,
        temProximaPagina: query.pagina < totalPaginas,
      },
      filtros: {
        categorias: categorias.filter(Boolean).sort(),
        marcas: marcas.filter(Boolean).sort(),
        linhas: linhas.filter(Boolean).sort(),
      },
    });
  } catch (error) {
    return logAndSendError(res, error, "listar treinamentos do cliente");
  }
};

export const buscarTreinamentoCliente = async (req, res) => {
  try {
    const now = new Date();
    const treinamento = await Treinamento.findOne({
      _id: req.params.id,
      ativo: true,
      publicadoEm: { $ne: null, $lte: now },
    })
      .select(CLIENT_DETAIL_FIELDS)
      .lean();

    if (!treinamento) {
      return res.status(404).json({ message: "Treinamento não encontrado ou indisponível" });
    }

    const progresso = await ProgressoTreinamento.findOne({
      treinamentoId: treinamento._id,
      usuarioId: req.usuario._id,
    })
      .select("-_id ultimaPosicaoSegundos percentualAssistido concluido ultimoAcessoEm concluidoEm")
      .lean();
    const { _id, ...publicFields } = treinamento;

    return res.status(200).json({
      treinamento: {
        id: _id,
        ...publicFields,
        progresso: progresso || emptyProgress,
        identificacaoAcesso: {
          nomeResponsavel: req.usuario.nomeResponsavel || "Distribuidor AtualPet",
          nomeFantasia: req.usuario.nomeFantasia || "Acesso exclusivo AtualPet",
          id: String(req.usuario._id).slice(-6),
        },
      },
    });
  } catch (error) {
    return logAndSendError(res, error, "buscar treinamento do cliente");
  }
};

export const atualizarProgresso = async (req, res) => {
  try {
    const treinamento = await Treinamento.findOne({
      _id: req.params.id,
      ativo: true,
      publicadoEm: { $ne: null, $lte: new Date() },
    })
      .select("_id duracaoSegundos")
      .lean();

    if (!treinamento) {
      return res.status(404).json({ message: "Treinamento não encontrado ou indisponível" });
    }

    let validation = validateProgressPayload(req.body);
    if (!validation.valid) return sendValidationError(res, validation.errors);

    if (treinamento.duracaoSegundos > 0) {
      validation = validateProgressPayload({
        posicaoSegundos: validation.data.posicaoSegundos,
        duracaoSegundos: treinamento.duracaoSegundos,
      });
      if (!validation.valid) return sendValidationError(res, validation.errors);
    }

    const now = new Date();
    const update = {
      $max: {
        ultimaPosicaoSegundos: validation.data.posicaoSegundos,
        duracaoSegundos: validation.data.duracaoSegundos,
        percentualAssistido: validation.data.percentualAssistido,
      },
      $set: { ultimoAcessoEm: now },
      $setOnInsert: { iniciadoEm: now },
    };

    if (validation.data.concluido) {
      const existing = await ProgressoTreinamento.findOne({
        treinamentoId: treinamento._id,
        usuarioId: req.usuario._id,
      })
        .select("concluido concluidoEm")
        .lean();
      update.$set.concluido = true;
      if (!existing?.concluidoEm) update.$set.concluidoEm = now;
    } else {
      update.$setOnInsert.concluido = false;
      update.$setOnInsert.concluidoEm = null;
    }

    const progresso = await ProgressoTreinamento.findOneAndUpdate(
      { treinamentoId: treinamento._id, usuarioId: req.usuario._id },
      update,
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: false,
      }
    )
      .select("-_id ultimaPosicaoSegundos percentualAssistido concluido ultimoAcessoEm concluidoEm")
      .lean();

    return res.status(200).json({
      message: "Progresso atualizado",
      progresso,
    });
  } catch (error) {
    return logAndSendError(res, error, "atualizar progresso");
  }
};
