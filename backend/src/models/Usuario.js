import mongoose from "mongoose";

const usuarioSchema = new mongoose.Schema(
    {
        nomeResponsavel: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        senha: {
            type: String,
            required: true,
        },

        tipo: {
            type: String,
            enum: ["admin", "comercial", "marketing", "logistica", "cliente", "groomer"],
            default: "cliente",
        },

        razaoSocial: {
            type: String,
            trim: true,
        },

        nomeFantasia: {
            type: String,
            trim: true,
        },

        // Campo legado mantido por compatibilidade; armazena CPF ou CNPJ normalizado.
        cnpj: {
            type: String,
            trim: true,
            unique: true,
            sparse: true,
        },

        telefone: {
            type: String,
            trim: true,
        },

        whatsapp: {
            type: String,
            trim: true,
        },

        cidade: {
            type: String,
            trim: true,
        },

        estado: {
            type: String,
            trim: true,
            uppercase: true,
        },

        nomeProfissional: {
            type: String,
            trim: true,
        },

        instagram: {
            type: String,
            trim: true,
        },

        tiktok: {
            type: String,
            trim: true,
        },

        observacaoCadastro: {
            type: String,
            trim: true,
        },

        tabelaPrecoId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "TabelaPreco"
        },

        statusCadastro: {
            type: String,
            enum: ["pendente", "aprovado", "reprovado", "inativo"],
            default: "pendente",
        },

        aprovadoEm: {
            type: Date,
        },

        ativo: {
            type: Boolean,
            default: true,
        },

        tokenVersion: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

usuarioSchema.index({ tipo: 1, statusCadastro: 1, ativo: 1, createdAt: -1 });

export default mongoose.model("Usuario", usuarioSchema);
