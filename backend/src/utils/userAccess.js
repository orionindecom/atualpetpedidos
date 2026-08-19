export const cadastroExternoBloqueiaAcesso = (usuario) => (
  ["cliente", "groomer"].includes(usuario?.tipo) &&
  usuario.statusCadastro !== "aprovado"
);

export const cadastroClienteBloqueiaAcesso = cadastroExternoBloqueiaAcesso;
