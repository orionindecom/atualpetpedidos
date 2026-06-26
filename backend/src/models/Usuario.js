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
            enum: ["admin", "cliente"],
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

        tabelaPrecoId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "TabelaPreco"
        },

        statusCadastro: {
            type: String,
            enum: ["pendente", "aprovado", "reprovado", "inativo"],
            default: "pendente",
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

export default mongoose.model("Usuario", usuarioSchema);
