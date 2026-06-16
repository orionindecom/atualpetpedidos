import Usuario from "../models/Usuario.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const gerarToken = (usuario) => {
    return jwt.sign(
        {
            id: usuario._id,
            tipo: usuario.tipo,
            tabelaPrecoId: usuario.tabelaPrecoId
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN
        }
    )
};

export const cadastrar = async (req, res) => {
    try {
        const {
            nomeResponsavel,
            email,
            senha,
            razaoSocial,
            nomeFantasia,
            cnpj,
            telefone,
            whatsapp,
        } = req.body;

        const usuarioExiste = await Usuario.findOne({ email });

        if (usuarioExiste) {
            return res.status(400).json({
                message: "E-mail já cadastrado",
            });
        }

        const senhaHash = await bcrypt.hash(senha, 10);

        const novoUsuario = await Usuario.create({
            nomeResponsavel,
            email,
            senha: senhaHash,
            razaoSocial,
            nomeFantasia,
            cnpj,
            telefone,
            whatsapp,
            tipo: "cliente",
            statusCadastro: "pendente",
        });

        res.status(201).json({
            message: "Cadastro realizado com sucesso. Aguarde aprovação.",
            usuario: {
                id: novoUsuario._id,
                nomeResponsavel: novoUsuario.nomeResponsavel,
                email: novoUsuario.email,
                statusCadastro: novoUsuario.statusCadastro,
            },
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
};

export const login = async (req, res) => {
    try {
        const { email, senha } = req.body;

        const usuario = await Usuario.findOne({ email });

        if (!usuario) {
            return res.status(401).json({
                message: "E-mail ou senha inválidos",
            });
        }

        const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

        if (!senhaCorreta) {
            return res.status(401).json({
                message: "E-mail ou senha inválidos",
            });
        }

        if (!usuario.ativo) {
            return res.status(403).json({
                message: "Usuário desativado",
            });
        }

        if (usuario.tipo === "cliente" && usuario.statusCadastro !== "aprovado") {
            return res.status(403).json({
                message: "Cadastro ainda não aprovado pelo administrador",
            });
        }

        usuario.ultimoLogin = new Date();
        await usuario.save();

        const token = gerarToken(usuario);

        res.status(200).json({
            message: "Login realizado com sucesso",
            token,
            usuario: {
                id: usuario._id,
                nomeResponsavel: usuario.nomeResponsavel,
                email: usuario.email,
                tipo: usuario.tipo,
                tabelaPrecoId: usuario.tabelaPrecoId,
                statusCadastro: usuario.statusCadastro
            }
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
};