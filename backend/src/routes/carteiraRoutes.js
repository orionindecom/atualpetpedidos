import express from 'express';
import Usuario from '../models/Usuario.js';
import Pedido from '../models/Pedido.js';
import { proteger } from '../middlewares/authMiddleware.js';
import { exigirPermissao } from '../middlewares/permissionMiddleware.js';
import { filtroCarteira } from '../services/authorizationService.js';
import { canAccessClient } from '../utils/permissions.js';
import { validateObjectIdParam, sendServerError } from '../utils/validation.js';
import { sanitizeClientOrder } from '../utils/pedidoLogistica.js';
const router = express.Router();
router.use(proteger, exigirPermissao('clientes'));
const fields = '_id nomeResponsavel nomeFantasia razaoSocial cnpj email telefone whatsapp cidade estado vendedorResponsavelId ativo statusCadastro';
router.get('/', async (req, res) => {
  try { return res.json(await Usuario.find({ tipo: 'cliente', ...filtroCarteira(req.usuario) }).select(fields).sort({ nomeFantasia: 1 }).lean()); }
  catch { return sendServerError(res); }
});
router.get('/:id', validateObjectIdParam(), async (req, res) => {
  try {
    const cliente = await Usuario.findById(req.params.id).select(fields + ' tipo').lean();
    if (!cliente || cliente.tipo !== 'cliente') return res.status(404).json({ message: 'Cliente não encontrado' });
    if (!canAccessClient(req.usuario, cliente)) return res.status(403).json({ message: 'Cliente fora da sua carteira' });
    const pedidos = await Pedido.find({ clienteId: cliente._id }).sort({ createdAt: -1 }).lean();
    return res.json({ cliente, pedidos: pedidos.map(sanitizeClientOrder) });
  } catch { return sendServerError(res); }
});
export default router;
