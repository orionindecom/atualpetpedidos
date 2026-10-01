import express from 'express';
import bcrypt from 'bcryptjs';
import Usuario from '../models/Usuario.js';
import { proteger } from '../middlewares/authMiddleware.js';
import { exigirPermissao } from '../middlewares/permissionMiddleware.js';
import { adminLimiter } from '../middlewares/rateLimitMiddleware.js';
import { isValidObjectId, isStrongEnoughPassword, validateObjectIdParam, sendServerError } from '../utils/validation.js';
import { PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions } from '../utils/permissions.js';

const router = express.Router();
const safe = (user) => { const value = user.toObject ? user.toObject() : { ...user }; delete value.senha; delete value.tokenVersion; value.permissoesEfetivas = effectivePermissions(value); return value; };
router.use(proteger, exigirPermissao('usuarios'), adminLimiter);
router.get('/', async (req, res) => {
  try {
    const usuarios = await Usuario.find().select('-senha -tokenVersion').sort({ nomeResponsavel: 1 }).lean();
    return res.json({ usuarios: usuarios.map(safe), permissoes: PERMISSIONS, perfis: ROLE_PERMISSIONS });
  } catch { return sendServerError(res); }
});
router.get('/presets', (req, res) => res.json({ permissoes: PERMISSIONS, perfis: ROLE_PERMISSIONS }));
router.get('/vendedores', async (req, res) => {
  try { return res.json(await Usuario.find({ tipo: 'vendedor', ativo: true }).select('_id nomeResponsavel email tipo ativo').sort({ nomeResponsavel: 1 }).lean()); }
  catch { return sendServerError(res); }
});
router.get('/responsaveis', async (req, res) => {
  try {
    const usuarios = await Usuario.find({ tipo: { $in: ['vendedor', 'comercial'] }, ativo: true })
      .select('_id nomeResponsavel tipo').sort({ nomeResponsavel: 1, _id: 1 }).lean();
    return res.json(usuarios.map(({ _id, nomeResponsavel, tipo }) => ({ _id, nomeResponsavel, tipo })));
  } catch { return sendServerError(res); }
});
const salvar = async (req, res) => {
  try {
    const { nomeResponsavel, email, tipo, ativo, permissoes, senha } = req.body;
    if (typeof nomeResponsavel !== 'string' || !nomeResponsavel.trim() || nomeResponsavel.length > 120 ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !Object.hasOwn(ROLE_PERMISSIONS, tipo) || typeof ativo !== 'boolean' ||
      !permissoes || typeof permissoes !== 'object' || Array.isArray(permissoes) ||
      Object.entries(permissoes).some(([key, value]) => !Object.hasOwn(PERMISSIONS, key) || typeof value !== 'boolean') ||
      ((!req.params.id || senha) && !isStrongEnoughPassword(senha))) {
      return res.status(400).json({ message: 'Dados do usuário inválidos. Informe nome, e-mail, perfil, status e uma senha forte para novos usuários.' });
    }
    const usuario = req.params.id ? await Usuario.findById(req.params.id) : new Usuario();
    if (!usuario) return res.status(404).json({ message: 'Usuário não encontrado' });
    if (String(usuario._id) === String(req.usuario._id) && (tipo !== 'admin' || !ativo)) {
      return res.status(409).json({ message: 'Você não pode remover seu próprio acesso administrativo' });
    }
    if (req.params.id && tipo !== usuario.tipo) {
      // Identidades externas com histórico não podem virar contas internas.
      if (['cliente', 'groomer'].includes(tipo) || ['cliente', 'groomer'].includes(usuario.tipo)) {
        return res.status(409).json({ message: 'Preserve o perfil de contas externas com histórico' });
      }
      const carteira = await Usuario.exists({ vendedorResponsavelId: usuario._id });
      if (carteira && !['vendedor', 'comercial'].includes(tipo)) return res.status(409).json({ message: 'Reatribua a carteira antes de alterar este perfil' });
    }
    const antes = req.params.id ? { nomeResponsavel: usuario.nomeResponsavel, email: usuario.email, tipo: usuario.tipo, ativo: usuario.ativo, permissoes: usuario.permissoes } : null;
    Object.assign(usuario, { nomeResponsavel: nomeResponsavel.trim(), email: email.trim().toLowerCase(), tipo, ativo, permissoes });
    usuario.historicoAdministrativo ||= [];
    usuario.historicoAdministrativo.push({ acao: req.params.id ? 'edicao' : 'criacao', autorId: req.usuario._id, em: new Date(), antes,
      depois: { nomeResponsavel: usuario.nomeResponsavel, email: usuario.email, tipo, ativo, permissoes } });
    if (senha) usuario.senha = await bcrypt.hash(senha, 12);
    if (req.params.id) usuario.tokenVersion = (usuario.tokenVersion || 0) + 1;
    await usuario.save();
    return res.status(req.params.id ? 200 : 201).json(safe(usuario));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'E-mail já cadastrado' });
    return sendServerError(res);
  }
};
router.post('/', salvar);
router.patch('/:id', validateObjectIdParam(), salvar);
router.get('/:id/carteira', validateObjectIdParam(), async (req, res) => {
  try { return res.json(await Usuario.find({ tipo: 'cliente', vendedorResponsavelId: req.params.id }).select('-senha -tokenVersion').lean()); }
  catch { return sendServerError(res); }
});
router.patch('/:id/vendedor', validateObjectIdParam(), async (req, res) => {
  try {
    const target = req.body.vendedorResponsavelId;
    const expected = req.body.vendedorResponsavelEsperadoId;
    if (!Object.hasOwn(req.body, 'vendedorResponsavelEsperadoId') ||
      (expected !== null && !isValidObjectId(expected))) {
      return res.status(400).json({ code: 'SELLER_ASSIGNMENT_EXPECTED_REQUIRED', message: 'Informe o vendedor responsável esperado (ID válido ou null).' });
    }
    if (target !== null && !isValidObjectId(target)) return res.status(400).json({ message: 'Vendedor inválido' });
    if (target) {
      const vendedor = await Usuario.findById(target).select('tipo ativo');
      if (!vendedor?.ativo || !['vendedor', 'comercial'].includes(vendedor.tipo)) return res.status(400).json({ message: 'Selecione um vendedor ou Comercial ativo' });
    }
    const cliente = await Usuario.findOneAndUpdate({ _id: req.params.id, tipo: 'cliente', vendedorResponsavelId: expected },
      { $set: { vendedorResponsavelId: target }, $push: { historicoAdministrativo: {
        acao: 'vendedor', autorId: req.usuario._id, em: new Date(),
        antes: { vendedorResponsavelId: expected }, depois: { vendedorResponsavelId: target },
      } } }, { returnDocument: 'after', runValidators: true }).select('-senha -tokenVersion');
    if (!cliente) {
      // Leitura apenas para informar o conflito; nunca decide ou precede a escrita.
      const atual = await Usuario.findById(req.params.id).select('tipo vendedorResponsavelId').lean();
      if (!atual || atual.tipo !== 'cliente') return res.status(404).json({ message: 'Cliente não encontrado' });
      const currentSellerId = atual.vendedorResponsavelId ?? null;
      const responsavel = currentSellerId ? await Usuario.findById(currentSellerId).select('nomeResponsavel').lean() : null;
      return res.status(409).json({ code: 'SELLER_ASSIGNMENT_CONFLICT',
        message: 'O vendedor responsável foi alterado por outro usuário.',
        currentSellerId, currentSellerName: responsavel?.nomeResponsavel ?? null });
    }
    return res.json(safe(cliente));
  } catch { return sendServerError(res); }
});
export default router;
