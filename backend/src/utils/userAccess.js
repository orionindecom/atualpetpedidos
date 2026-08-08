export const cadastroClienteBloqueiaAcesso = (usuario) => (
  usuario?.tipo === "cliente" && usuario.statusCadastro !== "aprovado"
);
