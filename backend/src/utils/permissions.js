// Ausência de overrides preserva os acessos dos perfis legados.
export const PERMISSIONS = {
  clientes: 'Visualizar clientes', criarPedidos: 'Criar pedidos para clientes',
  editarPedidos: 'Editar pedidos', pedidosTodos: 'Visualizar todos os pedidos',
  pedidosCarteira: 'Visualizar pedidos da carteira', treinamentos: 'Visualizar treinamentos',
  acompanharTreinamentos: 'Visualizar acompanhamento de treinamentos',
  criarTreinamentos: 'Criar treinamentos', editarTreinamentos: 'Editar treinamentos',
  excluirTreinamentos: 'Excluir treinamentos',
  materiais: 'Visualizar materiais de marketing', usuarios: 'Gerenciar usuários',
  comercial: 'Gerenciar preços e tabelas', conteudo: 'Gerenciar conteúdo',
  logistica: 'Acessar logística', producao: 'Acessar produção',
  conferencia: 'Executar conferência', faturamento: 'Executar faturamento',
  aprovarPedidos: 'Aprovar pedidos', excluirPedidos: 'Excluir pedidos',
};
const vendedor = ['clientes', 'criarPedidos', 'editarPedidos', 'pedidosCarteira'];
export const ROLE_PERMISSIONS = {
  admin: Object.keys(PERMISSIONS),
  vendedor,
  comercial: [...vendedor, 'pedidosTodos', 'comercial', 'aprovarPedidos', 'excluirPedidos', 'treinamentos', 'acompanharTreinamentos'],
  marketing: ['conteudo', 'treinamentos', 'acompanharTreinamentos', 'criarTreinamentos', 'editarTreinamentos', 'excluirTreinamentos'],
  logistica: ['logistica', 'producao', 'conferencia', 'faturamento'],
  cliente: ['treinamentos', 'materiais'], groomer: ['treinamentos', 'materiais'],
};
export const hasPermission = (user, permission) => {
  if (!user || user.ativo === false || !Object.hasOwn(PERMISSIONS, permission)) return false;
  if (user.tipo === 'admin') return true;
  // Operação exige a identidade logística e identificação por PIN já existentes.
  if (['logistica', 'producao', 'conferencia', 'faturamento'].includes(permission) && user.tipo !== 'logistica') return false;
  // Vendedor mantém o limite de carteira mesmo se receber acesso a listas globais.
  if (user.tipo === 'vendedor' && permission === 'pedidosTodos') return false;
  const override = user.permissoes && Object.hasOwn(user.permissoes, permission) ? user.permissoes[permission] : undefined;
  return typeof override === 'boolean' ? override : (ROLE_PERMISSIONS[user.tipo] || []).includes(permission);
};
export const isSalesUser = (user) => ['vendedor', 'comercial', 'admin'].includes(user?.tipo);
export const hasGlobalScope = (user) => Boolean(user && user.ativo !== false && (['admin', 'comercial'].includes(user.tipo) || hasPermission(user, 'pedidosTodos')));
export const effectivePermissions = (user) => Object.fromEntries(Object.keys(PERMISSIONS).map((key) => [key, hasPermission(user, key)]));
export const canAccessClient = (user, client) => Boolean(user && client && (
  (user.tipo === 'cliente' && String(user._id) === String(client._id)) ||
  (hasPermission(user, 'clientes') && (hasGlobalScope(user) ||
    String(client.vendedorResponsavelId || '') === String(user._id)))
));
