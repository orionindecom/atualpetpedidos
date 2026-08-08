import BannerMarketing from "../models/BannerMarketing.js";
import {
  buildAudienceFilter,
  validateAudienceDistributors,
} from "../utils/contentAudience.js";
import {
  deleteImageByPublicId,
  ImageUploadError,
  uploadImageBufferDetails,
} from "../utils/cloudinaryUpload.js";
import {
  parseBannerQuery,
  validateBannerPayload,
} from "../utils/bannerMarketingValidation.js";
import { escapeRegex } from "../utils/materialMarketingValidation.js";
import { sendServerError } from "../utils/validation.js";

const BANNER_FOLDER = "atualpet/banners";
const CLIENT_FIELDS =
  "_id imagemUrl link ordem dataInicial dataFinal";

const sendValidationError = (res, errors) => res.status(400).json({
  message: "Revise os dados do banner",
  errors,
});

const sanitizeBanner = (banner) => {
  const safe = banner?.toObject ? banner.toObject() : { ...banner };
  delete safe.imagemPublicId;
  return safe;
};

const uploadBanner = (file) => uploadImageBufferDetails(file, {
  errorMessage: "Não foi possível enviar a imagem do banner",
  folder: BANNER_FOLDER,
  requirePublicId: true,
});

const removeBannerBestEffort = async (publicId) => {
  if (!publicId) return;
  try {
    await deleteImageByPublicId(publicId, { allowedFolder: BANNER_FOLDER });
  } catch (error) {
    console.error("[banners] Falha ao limpar imagem", {
      name: error?.name,
      code: error?.cause?.http_code || error?.code,
    });
  }
};

const handleError = (res, error, operation) => {
  if (error instanceof ImageUploadError) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  console.error(`[banners] Falha em ${operation}`, {
    name: error?.name,
    code: error?.code,
  });
  return sendServerError(res);
};

export const buildClientBannerFilter = (usuarioId, now = new Date()) => ({
  ativo: true,
  $and: [
    {
      $or: [
        { dataInicial: { $lte: now } },
        { dataInicial: null },
        { dataInicial: { $exists: false } },
      ],
    },
    {
      $or: [
        { dataFinal: { $gte: now } },
        { dataFinal: null },
        { dataFinal: { $exists: false } },
      ],
    },
    buildAudienceFilter(usuarioId),
  ],
});

export const listarBannersCliente = async (req, res) => {
  try {
    const banners = await BannerMarketing.find(
      buildClientBannerFilter(req.usuario._id)
    )
      .select(CLIENT_FIELDS)
      .sort({ ordem: 1, createdAt: -1, _id: 1 })
      .limit(10)
      .lean()
      .maxTimeMS(5000);

    return res.status(200).json({ banners });
  } catch (error) {
    return handleError(res, error, "listar banners do cliente");
  }
};

export const listarBannersGestao = async (req, res) => {
  try {
    const query = parseBannerQuery(req.query);
    if (!query) {
      return res.status(400).json({ message: "Parâmetros de filtro inválidos" });
    }

    const filter = {};
    if (query.active !== null) filter.ativo = query.active;
    if (query.search) {
      filter.tituloInterno = new RegExp(escapeRegex(query.search), "i");
    }

    const skip = (query.page - 1) * query.limit;
    const [banners, totalItens] = await Promise.all([
      BannerMarketing.find(filter)
        .select("-__v -imagemPublicId")
        .populate("criadoPor", "nomeResponsavel email tipo")
        .sort({ ordem: 1, createdAt: -1, _id: 1 })
        .skip(skip)
        .limit(query.limit)
        .lean()
        .maxTimeMS(5000),
      BannerMarketing.countDocuments(filter).maxTimeMS(5000),
    ]);

    return res.status(200).json({
      banners,
      paginacao: {
        paginaAtual: query.page,
        totalPaginas: Math.ceil(totalItens / query.limit),
        totalItens,
        limite: query.limit,
      },
    });
  } catch (error) {
    return handleError(res, error, "listar banners da gestão");
  }
};

export const criarBanner = async (req, res) => {
  let uploadedImage = null;
  try {
    const validation = validateBannerPayload(req.body);
    if (!validation.valid) return sendValidationError(res, validation.errors);
    if (!req.file) {
      return sendValidationError(res, { imagem: "Selecione a imagem do banner" });
    }

    if (!await validateAudienceDistributors(validation.data)) {
      return sendValidationError(res, {
        distribuidoresIds: "Selecione distribuidores ativos e aprovados",
      });
    }

    uploadedImage = await uploadBanner(req.file);
    let banner;
    try {
      banner = await BannerMarketing.create({
        ...validation.data,
        imagemUrl: uploadedImage.secureUrl,
        imagemPublicId: uploadedImage.publicId,
        criadoPor: req.usuario._id,
      });
    } catch (error) {
      await removeBannerBestEffort(uploadedImage.publicId);
      throw error;
    }

    return res.status(201).json({
      message: "Banner criado com sucesso",
      banner: sanitizeBanner(banner),
    });
  } catch (error) {
    return handleError(res, error, "criar banner");
  }
};

export const atualizarBanner = async (req, res) => {
  let uploadedImage = null;
  try {
    const removeImage = req.body?.removerImagem === true ||
      req.body?.removerImagem === "true";
    if (removeImage && !req.file) {
      return sendValidationError(res, {
        imagem: "O banner precisa manter uma imagem",
      });
    }

    const validation = validateBannerPayload(req.body, {
      allowEmpty: Boolean(req.file),
      partial: true,
    });
    if (!validation.valid) return sendValidationError(res, validation.errors);

    const banner = await BannerMarketing.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner não encontrado" });

    const nextAudience = {
      audienciaTipo: validation.data.audienciaTipo ?? banner.audienciaTipo,
      distribuidoresIds:
        validation.data.distribuidoresIds ?? banner.distribuidoresIds,
    };
    if (!await validateAudienceDistributors(nextAudience)) {
      return sendValidationError(res, {
        distribuidoresIds: "Selecione distribuidores ativos e aprovados",
      });
    }

    const nextStart = validation.data.dataInicial !== undefined
      ? validation.data.dataInicial
      : banner.dataInicial;
    const nextEnd = validation.data.dataFinal !== undefined
      ? validation.data.dataFinal
      : banner.dataFinal;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      return sendValidationError(res, {
        dataFinal: "A data final deve ser posterior à data inicial",
      });
    }

    const previousPublicId = banner.imagemPublicId;
    for (const [field, value] of Object.entries(validation.data)) {
      banner[field] = value;
    }

    if (req.file) {
      uploadedImage = await uploadBanner(req.file);
      banner.imagemUrl = uploadedImage.secureUrl;
      banner.imagemPublicId = uploadedImage.publicId;
    }

    try {
      await banner.save();
    } catch (error) {
      await removeBannerBestEffort(uploadedImage?.publicId);
      throw error;
    }

    if (uploadedImage && previousPublicId) {
      await removeBannerBestEffort(previousPublicId);
    }

    return res.status(200).json({
      message: "Banner atualizado com sucesso",
      banner: sanitizeBanner(banner),
    });
  } catch (error) {
    return handleError(res, error, "atualizar banner");
  }
};

export const alterarStatusBanner = async (req, res) => {
  try {
    if (typeof req.body?.ativo !== "boolean") {
      return sendValidationError(res, { ativo: "Informe verdadeiro ou falso" });
    }

    const banner = await BannerMarketing.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner não encontrado" });

    banner.ativo = req.body.ativo;
    await banner.save();
    return res.status(200).json({
      message: banner.ativo ? "Banner ativado com sucesso" : "Banner desativado com sucesso",
      banner: sanitizeBanner(banner),
    });
  } catch (error) {
    return handleError(res, error, "alterar status do banner");
  }
};

export const excluirBanner = async (req, res) => {
  try {
    const banner = await BannerMarketing.findByIdAndDelete(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner não encontrado" });

    await removeBannerBestEffort(banner.imagemPublicId);
    return res.status(200).json({ message: "Banner excluído com sucesso" });
  } catch (error) {
    return handleError(res, error, "excluir banner");
  }
};
