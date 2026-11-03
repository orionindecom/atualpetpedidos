import crypto from "node:crypto";
import { Readable } from "node:stream";
import cloudinary from "../config/cloudinary.js";
import { NATAL_2026 } from "../config/natalPremiado2026.js";

// Comprovantes de compra: validação do arquivo e armazenamento privado.
// No Cloudinary os arquivos ficam com entrega "authenticated" e só são
// lidos pelo backend, que verifica a permissão antes de repassar o conteúdo.

export const COMPROVANTE_MIME_TYPES = Object.freeze({
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
});

const FORMATO_POR_MIME = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
});

export class ComprovanteError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ComprovanteError";
    this.statusCode = statusCode;
  }
}

const temAssinatura = (buffer, mimetype) => {
  if (!buffer || buffer.length < 12) return false;
  if (mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimetype === "image/webp") {
    return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  if (mimetype === "application/pdf") {
    return buffer.subarray(0, 1024).toString("latin1").includes("%PDF-");
  }
  return false;
};

// Recursos ativos não fazem sentido em notas e recibos e são vetores comuns de ataque.
const PDF_RECURSOS_BLOQUEADOS = [/\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFiles?\b/, /\/RichMedia\b/, /\/XFA\b/];

export const validarArquivoComprovante = (file, config = NATAL_2026) => {
  if (!file?.buffer) throw new ComprovanteError("Anexe o comprovante da compra (imagem ou PDF).");
  const { buffer, mimetype } = file;
  const extensoes = COMPROVANTE_MIME_TYPES[mimetype];
  if (!extensoes) throw new ComprovanteError("Envie o comprovante em JPG, PNG, WEBP ou PDF.");
  const nome = String(file.originalname || "").toLowerCase();
  const extensao = nome.includes(".") ? nome.split(".").pop() : "";
  if (extensao && !extensoes.includes(extensao)) {
    throw new ComprovanteError("A extensão do arquivo não corresponde ao tipo enviado.");
  }
  if (buffer.length > config.comprovante.maxBytes) {
    throw new ComprovanteError("O comprovante deve ter no máximo 10 MB.");
  }
  if (buffer.length < config.comprovante.minBytes) {
    throw new ComprovanteError("O arquivo enviado está vazio ou corrompido.");
  }
  if (!temAssinatura(buffer, mimetype)) {
    throw new ComprovanteError("O arquivo enviado não é uma imagem ou PDF válido.");
  }
  if (mimetype === "application/pdf") {
    const conteudo = buffer.toString("latin1");
    if (PDF_RECURSOS_BLOQUEADOS.some((padrao) => padrao.test(conteudo))) {
      throw new ComprovanteError("O PDF contém recursos não permitidos. Envie uma foto ou um PDF simples do comprovante.");
    }
  }
  return {
    mimetype,
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    nomeOriginal: String(file.originalname || "comprovante").replace(/[^\w.\- ]+/g, "_").slice(0, 120),
  };
};

// NATAL2026_CLOUDINARY_PASTA permite isolar os arquivos de testes (ex.: homologação).
const PASTA = /^atualpet\/[\w\-/]+$/.test(process.env.NATAL2026_CLOUDINARY_PASTA || "")
  ? process.env.NATAL2026_CLOUDINARY_PASTA
  : "atualpet/natal-2026/comprovantes";

const cloudinaryStorage = {
  provider: "cloudinary",
  salvar: (buffer, { mimetype }) => new Promise((resolve, reject) => {
    const pdf = mimetype === "application/pdf";
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: PASTA,
        type: "authenticated",
        resource_type: pdf ? "raw" : "image",
        ...(pdf ? { public_id: `${crypto.randomUUID()}.pdf` } : { allowed_formats: ["jpg", "jpeg", "png", "webp"] }),
        use_filename: false,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result?.public_id) {
          console.error("[natal-2026] Falha no upload do comprovante", { code: error?.http_code });
          return reject(new ComprovanteError("Não foi possível armazenar o comprovante. Tente novamente.", 502));
        }
        return resolve({
          provider: "cloudinary",
          chave: result.public_id,
          resourceType: pdf ? "raw" : "image",
          formato: pdf ? "pdf" : result.format,
        });
      }
    );
    stream.on("error", () => reject(new ComprovanteError("Não foi possível armazenar o comprovante. Tente novamente.", 502)));
    stream.end(buffer);
  }),
  // A entrega por URL assinada de arquivos "raw" (PDF) é bloqueada pela conta
  // (401 "deny or ACL failure"). O download privado pela API, com validade curta,
  // funciona para imagens e PDFs e nunca expõe o endereço ao navegador.
  abrir: async (comprovante) => {
    const resourceType = comprovante.resourceType || "image";
    const formato = resourceType === "raw" ? "" : (comprovante.formato || FORMATO_POR_MIME[comprovante.mimetype] || "");
    const url = cloudinary.utils.private_download_url(comprovante.chave, formato, {
      resource_type: resourceType,
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 120,
    });
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    } catch (error) {
      console.error("[natal-2026] Falha de rede ao ler comprovante", { name: error?.name });
      throw new ComprovanteError("Não foi possível carregar o comprovante agora. Tente novamente.", 502);
    }
    if (!response.ok || !response.body) {
      console.error("[natal-2026] Cloudinary recusou a leitura do comprovante", {
        status: response.status,
        erro: response.headers.get("x-cld-error"),
        resourceType,
      });
      throw new ComprovanteError(
        response.status === 404 ? "O arquivo deste comprovante não foi encontrado no armazenamento." : "Não foi possível carregar o comprovante agora. Tente novamente.",
        response.status === 404 ? 404 : 502
      );
    }
    return Readable.fromWeb(response.body);
  },
  remover: async (comprovante) => {
    await cloudinary.uploader.destroy(comprovante.chave, {
      resource_type: comprovante.resourceType || "image",
      type: "authenticated",
      invalidate: true,
    });
  },
};

let storage = cloudinaryStorage;

export const getComprovanteStorage = () => storage;

// Permite substituir o armazenamento em testes sem tocar no Cloudinary.
export const setComprovanteStorage = (custom) => { storage = custom || cloudinaryStorage; };

export const criarStorageMemoria = () => {
  const arquivos = new Map();
  return {
    provider: "memoria",
    arquivos,
    salvar: async (buffer) => {
      const chave = crypto.randomUUID();
      arquivos.set(chave, Buffer.from(buffer));
      return { provider: "memoria", chave, resourceType: "memoria", formato: "" };
    },
    abrir: async (comprovante) => {
      if (!arquivos.has(comprovante.chave)) throw new ComprovanteError("Comprovante indisponível no momento.", 404);
      return Readable.from(arquivos.get(comprovante.chave));
    },
    remover: async (comprovante) => { arquivos.delete(comprovante.chave); },
  };
};
