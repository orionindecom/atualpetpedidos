import MaterialMarketing from "../models/MaterialMarketing.js";
import {
  buildMaterialFilter,
  MATERIAL_SORT,
  parseMaterialQuery,
  validateMaterialPayload,
} from "../utils/materialMarketingValidation.js";
import {
  deleteImageByPublicId,
  ImageUploadError,
  uploadImageBufferDetails,
} from "../utils/cloudinaryUpload.js";
import { sendServerError } from "../utils/validation.js";

const MATERIAL_IMAGE_FOLDER = "atualpet/materiais-marketing";
const CLIENT_FIELDS =
  "_id titulo descricao categoria tipo marca linha linkExterno imagemCapaUrl destaque ordem createdAt updatedAt";

const sendValidationError = (res, errors) =>
  res.status(400).json({
    message: "Revise os dados do material",
    errors,
  });

const sanitizeMaterial = (material) => {
  const safe = material?.toObject
    ? material.toObject()
    : { ...material };
  delete safe.imagemCapaPublicId;
  return safe;
};

const isRemovalRequested = (value) => value === true || value === "true";

const uploadCover = (file) => uploadImageBufferDetails(file, {
  errorMessage: "Não foi possível enviar a imagem de capa do material",
  folder: MATERIAL_IMAGE_FOLDER,
  requirePublicId: true,
});

const removeCoverBestEffort = async (publicId) => {
  if (!publicId) return;

  try {
    await deleteImageByPublicId(publicId, {
      allowedFolder: MATERIAL_IMAGE_FOLDER,
    });
  } catch (error) {
    console.error("[materiais-marketing] Falha ao limpar imagem de capa", {
      name: error?.name,
      code: error?.cause?.http_code || error?.code,
    });
  }
};

const logAndSendError = (res, error, operation) => {
  console.error(`[materiais-marketing] Falha em ${operation}`, {
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

const listMaterials = async (req, res, { admin }) => {
  const query = parseMaterialQuery(req.query, { admin });

  if (!query) {
    return res.status(400).json({
      message: "Parâmetros de paginação ou filtro inválidos",
    });
  }

  const filter = buildMaterialFilter(query, { onlyActive: !admin });
  const filterScope = admin ? {} : { ativo: true };
  const skip = (query.pagina - 1) * query.limite;
  let materialQuery = MaterialMarketing.find(filter)
    .sort(MATERIAL_SORT)
    .skip(skip)
    .limit(query.limite);

  if (!admin) {
    materialQuery = materialQuery.select(CLIENT_FIELDS);
  } else {
    materialQuery = materialQuery.select("-__v -imagemCapaPublicId");
  }

  materialQuery = materialQuery.lean().maxTimeMS(5000);

  const [materiais, totalItens, categorias, tipos, marcas, linhas] =
    await Promise.all([
      materialQuery,
      MaterialMarketing.countDocuments(filter).maxTimeMS(5000),
      MaterialMarketing.distinct("categoria", filterScope),
      MaterialMarketing.distinct("tipo", filterScope),
      MaterialMarketing.distinct("marca", filterScope),
      MaterialMarketing.distinct("linha", filterScope),
    ]);

  const totalPaginas = Math.ceil(totalItens / query.limite);

  return res.status(200).json({
    materiais,
    paginacao: {
      paginaAtual: query.pagina,
      totalPaginas,
      totalItens,
      limite: query.limite,
      temProximaPagina: query.pagina < totalPaginas,
    },
    filtros: {
      categorias: categorias.filter(Boolean).sort(),
      tipos: tipos.filter(Boolean).sort(),
      marcas: marcas.filter(Boolean).sort(),
      linhas: linhas.filter(Boolean).sort(),
    },
  });
};

export const listarMateriaisCliente = async (req, res) => {
  try {
    return await listMaterials(req, res, { admin: false });
  } catch (error) {
    return logAndSendError(res, error, "listar materiais do cliente");
  }
};

export const listarMateriaisAdmin = async (req, res) => {
  try {
    return await listMaterials(req, res, { admin: true });
  } catch (error) {
    return logAndSendError(res, error, "listar materiais do admin");
  }
};

export const buscarMaterialAdmin = async (req, res) => {
  try {
    const material = await MaterialMarketing.findById(req.params.id)
      .select("-__v -imagemCapaPublicId")
      .lean();

    if (!material) {
      return res.status(404).json({ message: "Material não encontrado" });
    }

    return res.status(200).json(material);
  } catch (error) {
    return logAndSendError(res, error, "buscar material");
  }
};

export const criarMaterial = async (req, res) => {
  let uploadedImage = null;

  try {
    const validation = validateMaterialPayload(req.body);

    if (!validation.valid) {
      return sendValidationError(res, validation.errors);
    }

    if (req.file) uploadedImage = await uploadCover(req.file);

    let material;
    try {
      material = await MaterialMarketing.create({
        ...validation.data,
        imagemCapaUrl: uploadedImage?.secureUrl || "",
        imagemCapaPublicId: uploadedImage?.publicId || "",
        criadoPor: req.usuario._id,
      });
    } catch (error) {
      await removeCoverBestEffort(uploadedImage?.publicId);
      throw error;
    }

    return res.status(201).json({
      message: "Material criado com sucesso",
      material: sanitizeMaterial(material),
    });
  } catch (error) {
    return handleControllerError(res, error, "criar material");
  }
};

export const atualizarMaterial = async (req, res) => {
  let uploadedImage = null;

  try {
    const removalRequested = isRemovalRequested(req.body?.removerImagemCapa);
    const validation = validateMaterialPayload(req.body, {
      allowEmpty: Boolean(req.file || removalRequested),
      partial: true,
    });

    if (!validation.valid) {
      return sendValidationError(res, validation.errors);
    }

    const material = await MaterialMarketing.findById(req.params.id);

    if (!material) {
      return res.status(404).json({ message: "Material não encontrado" });
    }

    const previousPublicId = material.imagemCapaPublicId;
    for (const [field, value] of Object.entries(validation.data)) {
      material[field] = value;
    }

    if (req.file) {
      uploadedImage = await uploadCover(req.file);
      material.imagemCapaUrl = uploadedImage.secureUrl;
      material.imagemCapaPublicId = uploadedImage.publicId;
    } else if (removalRequested) {
      material.imagemCapaUrl = "";
      material.imagemCapaPublicId = "";
    }

    try {
      await material.save();
    } catch (error) {
      await removeCoverBestEffort(uploadedImage?.publicId);
      throw error;
    }

    if ((uploadedImage || removalRequested) && previousPublicId) {
      await removeCoverBestEffort(previousPublicId);
    }

    return res.status(200).json({
      message: "Material atualizado com sucesso",
      material: sanitizeMaterial(material),
    });
  } catch (error) {
    return handleControllerError(res, error, "atualizar material");
  }
};

export const alterarStatusMaterial = async (req, res) => {
  try {
    if (typeof req.body?.ativo !== "boolean") {
      return sendValidationError(res, {
        ativo: "Informe verdadeiro ou falso",
      });
    }

    const material = await MaterialMarketing.findById(req.params.id);

    if (!material) {
      return res.status(404).json({ message: "Material não encontrado" });
    }

    material.ativo = req.body.ativo;
    await material.save();

    return res.status(200).json({
      message: material.ativo
        ? "Material ativado com sucesso"
        : "Material desativado com sucesso",
      material: sanitizeMaterial(material),
    });
  } catch (error) {
    return logAndSendError(res, error, "alterar status do material");
  }
};

export const excluirMaterial = async (req, res) => {
  try {
    const material = await MaterialMarketing.findByIdAndDelete(req.params.id);

    if (!material) {
      return res.status(404).json({ message: "Material não encontrado" });
    }

    await removeCoverBestEffort(material.imagemCapaPublicId);
    return res.status(200).json({ message: "Material excluído com sucesso" });
  } catch (error) {
    return logAndSendError(res, error, "excluir material");
  }
};
