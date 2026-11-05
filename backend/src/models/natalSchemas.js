import mongoose from "mongoose";

// Subdocumentos compartilhados pelos modelos da campanha Natal Premiado 2026.

export const autorNatalSchema = new mongoose.Schema(
  {
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
    usuarioNome: { type: String, trim: true, maxlength: 160 },
    usuarioTipo: {
      type: String,
      enum: ["admin", "comercial", "vendedor", "cliente", "logistica", "sistema", "publico"],
      required: true,
    },
  },
  { _id: false }
);

export const beneficiosNatalSchema = new mongoose.Schema(
  {
    // Nível 0 representa "sem benefícios" (pedido abaixo de R$ 12.000 após revisão).
    nivel: { type: Number, required: true, min: 0 },
    valorMinimo: { type: Number, required: true, min: 0 },
    cupons: { type: Number, required: true, min: 0 },
    marketingPercentual: { type: Number, required: true, min: 0 },
    produtosPercentual: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

export const contadoresNatalSchema = new mongoose.Schema(
  {
    aprovados: { type: Number, default: 0 },
    pendentes: { type: Number, default: 0 },
    rejeitados: { type: Number, default: 0 },
    cancelados: { type: Number, default: 0 },
    invalidados: { type: Number, default: 0 },
    invalidadosRevisao: { type: Number, default: 0 },
  },
  { _id: false }
);

// Decisão administrativa tomada quando uma redução atinge benefícios já concedidos.
export const revisaoNatalSchema = new mongoose.Schema(
  {
    em: { type: Date, required: true },
    autor: { type: autorNatalSchema, required: true },
    decisao: { type: String, enum: ["manter", "adequar"], required: true },
    justificativa: { type: String, trim: true, required: true, maxlength: 1000 },
    valorAnterior: { type: Number, required: true },
    valorNovo: { type: Number, required: true },
    faixaAnterior: { type: beneficiosNatalSchema, required: true },
    faixaDoNovoValor: { type: beneficiosNatalSchema, required: true },
    faixaResultante: { type: beneficiosNatalSchema, required: true },
    aprovadasAntes: { type: Number, default: 0 },
    pendentesNoMomento: { type: Number, default: 0 },
    participacoesInvalidadas: {
      type: [new mongoose.Schema(
        {
          participacaoId: { type: mongoose.Schema.Types.ObjectId, required: true },
          protocolo: String,
          cupomNumero: Number,
          cupomCodigo: String,
          recebidoEm: Date,
        },
        { _id: false }
      )],
      default: [],
    },
    // Bonificações já entregues não são desfeitas automaticamente: só sinalizadas.
    ajusteBonificacaoPendente: { type: Boolean, default: false },
    pedidoId: { type: mongoose.Schema.Types.ObjectId, ref: "Pedido" },
    numeroPedido: { type: String, trim: true },
  },
  { _id: true }
);

export const buildAutorNatal = (usuario, fallbackTipo = "sistema") => {
  if (!usuario) return { usuarioTipo: fallbackTipo, usuarioNome: fallbackTipo === "sistema" ? "Sistema" : undefined };
  return {
    usuarioId: usuario._id,
    usuarioNome: usuario.nomeResponsavel || usuario.nomeFantasia || usuario.nomeProfissional || "Usuário",
    usuarioTipo: usuario.tipo,
  };
};
