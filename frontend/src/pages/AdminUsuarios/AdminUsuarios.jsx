import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import EmptyState from "../../components/AdminUi/EmptyState";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import ui from "../../components/AdminUi/AdminUi.module.css";
import { FilterToolbar } from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import PortfolioModal from "../../components/UserForm/PortfolioModal";
import UserFormModal from "../../components/UserForm/UserFormModal";
import { getApiErrorMessage } from "../../utils/apiErrors";
import { getAuthSession } from "../../utils/authSession";
import { getClientName } from "../../utils/sellerAssignment";
import { EXTERNAL_PROFILES, PROFILE_LABELS, filterUsers, profileLabel } from "../../utils/userAdmin";
import styles from "./AdminUsuarios.module.css";

const profileTone = (tipo) => (tipo === "cliente" ? "info" : tipo === "groomer" ? "accent" : "brand");

function AdminUsuarios() {
  const currentUserId = getAuthSession()?.usuario?._id;
  const [dados, setDados] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busca, setBusca] = useState("");
  const [perfil, setPerfil] = useState("");
  const [status, setStatus] = useState("");
  const { toast } = useFeedback();
  const [editing, setEditing] = useState(undefined);
  const [portfolioSeller, setPortfolioSeller] = useState(null);

  const fetchUsers = useCallback(async () => (await api.get("/usuarios")).data, []);

  const carregar = useCallback(async () => {
    setLoadError("");
    try {
      const data = await fetchUsers();
      setDados(data);
      return data;
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Não foi possível carregar os usuários."));
      return null;
    }
  }, [fetchUsers]);

  useEffect(() => {
    let active = true;
    fetchUsers()
      .then((data) => { if (active) setDados(data); })
      .catch((error) => { if (active) setLoadError(getApiErrorMessage(error, "Não foi possível carregar os usuários.")); });
    return () => { active = false; };
  }, [fetchUsers]);

  const usuarios = useMemo(() => dados?.usuarios || [], [dados]);
  const presets = useMemo(() => (dados ? { permissoes: dados.permissoes, perfis: dados.perfis } : null), [dados]);
  const byId = useMemo(() => new Map(usuarios.map((user) => [String(user._id), user])), [usuarios]);
  const nameOf = useCallback((id) => byId.get(String(id))?.nomeResponsavel || "outro responsável", [byId]);
  const clientes = useMemo(() => usuarios.filter((user) => user.tipo === "cliente")
    .sort((a, b) => getClientName(a).localeCompare(getClientName(b), "pt-BR")), [usuarios]);
  const portfolioCount = useMemo(() => {
    const counts = new Map();
    for (const client of clientes) {
      if (client.vendedorResponsavelId) {
        const key = String(client.vendedorResponsavelId);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  }, [clientes]);
  const visiveis = useMemo(() => filterUsers(usuarios, { busca, perfil, status }), [busca, perfil, status, usuarios]);

  const saved = async (user, { isNew, isSelf }) => {
    setEditing(undefined);
    await carregar();
    if (isNew) {
      toast.success("Usuário criado", { description: `${user.nomeResponsavel} já pode entrar na Central com a senha inicial.` });
    } else {
      toast.success("Alterações salvas", {
        description: isSelf
          ? "Entre novamente para continuar."
          : `${user.nomeResponsavel} precisará entrar novamente para usar os novos acessos.`,
      });
    }
  };

  const portfolioLabel = (user) => {
    if (user.tipo === "vendedor") {
      const count = portfolioCount.get(String(user._id)) || 0;
      return count ? `${count} ${count === 1 ? "cliente" : "clientes"}` : "Sem clientes";
    }
    if (user.tipo === "comercial" || user.tipo === "admin") return "Visão global";
    if (user.tipo === "cliente") return user.vendedorResponsavelId ? nameOf(user.vendedorResponsavelId) : "Sem vendedor";
    return "—";
  };

  return (
    <>
      <Navbar />
      <main className={ui.container}>
        <PageHeader
          eyebrow="Relacionamento"
          title="Usuários e permissões"
          description="Gerencie quem acessa a Central, com qual perfil e quais permissões."
          action={(
            <button type="button" className={ui.primaryButton} onClick={() => setEditing(null)} disabled={!presets}>
              + Novo usuário
            </button>
          )}
        />


        <FilterToolbar
          activeFilterCount={Number(Boolean(perfil)) + Number(Boolean(status))}
          searchLabel="Buscar usuário"
          searchPlaceholder="Buscar por nome, empresa ou e-mail..."
          searchValue={busca}
          onSearchChange={(event) => setBusca(event.target.value)}
          onSubmit={(event) => event.preventDefault()}
          onClear={() => { setBusca(""); setPerfil(""); setStatus(""); }}
        >
          <select aria-label="Filtrar por perfil" value={perfil} onChange={(event) => setPerfil(event.target.value)}>
            <option value="">Todos os perfis</option>
            <option value="internos">Equipe interna</option>
            {Object.entries(PROFILE_LABELS).map(([tipo, label]) => <option key={tipo} value={tipo}>{label}</option>)}
          </select>
          <select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos os status</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
        </FilterToolbar>

        <div className={ui.listMeta}>
          <strong>{dados ? `${visiveis.length} ${visiveis.length === 1 ? "usuário" : "usuários"}` : "Carregando usuários"}</strong>
          {dados && <span>{usuarios.filter((user) => user.ativo !== false).length} ativos de {usuarios.length}</span>}
        </div>

        <section className={ui.panel} aria-label="Usuários cadastrados" aria-busy={!dados && !loadError}>
          {loadError ? (
            <div className={ui.stateBox} role="alert">
              <h2>Não foi possível carregar os usuários</h2>
              <p>{loadError}</p>
              <button type="button" className={`${ui.secondaryButton} ${styles.retry}`} onClick={carregar}>Tentar novamente</button>
            </div>
          ) : !dados ? (
            [1, 2, 3, 4].map((item) => <div className={ui.skeletonRow} key={item} />)
          ) : visiveis.length === 0 ? (
            <EmptyState
              icon="search"
              title="Nenhum usuário encontrado"
              description="Ajuste a busca ou os filtros para ver outros usuários."
            />
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">E-mail</th>
                  <th scope="col">Perfil</th>
                  <th scope="col">Status</th>
                  <th scope="col">Carteira</th>
                  <th scope="col"><span className={ui.srOnly}>Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((user) => {
                  const isClient = EXTERNAL_PROFILES.includes(user.tipo);
                  const name = isClient && user.tipo === "cliente" ? getClientName(user) : user.nomeResponsavel;
                  return (
                    <tr key={user._id} data-inactive={user.ativo === false}>
                      <td data-label="Nome">
                        <strong className={styles.name}>{name}</strong>
                        {isClient && user.nomeResponsavel !== name && <small className={styles.sub}>{user.nomeResponsavel}</small>}
                        {String(user._id) === String(currentUserId) && <small className={styles.sub}>Você</small>}
                      </td>
                      <td data-label="E-mail" className={styles.email}>{user.email}</td>
                      <td data-label="Perfil"><span className={ui.badge} data-tone={profileTone(user.tipo)}>{profileLabel(user.tipo)}</span></td>
                      <td data-label="Status">
                        <span className={ui.badge} data-tone={user.ativo === false ? "inactive" : "active"}>
                          {user.ativo === false ? "Inativo" : "Ativo"}
                        </span>
                      </td>
                      <td data-label="Carteira" className={styles.muted}>{portfolioLabel(user)}</td>
                      <td className={styles.actions}>
                        {user.tipo === "vendedor" && (
                          <button type="button" className={ui.ghostButton} onClick={() => setPortfolioSeller(user)} aria-label={`Editar carteira de ${user.nomeResponsavel}`}>
                            Carteira
                          </button>
                        )}
                        <button type="button" className={ui.secondaryButton} onClick={() => setEditing(user)} aria-label={`Editar ${name}`}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {editing !== undefined && presets && (
        <UserFormModal
          user={editing}
          presets={presets}
          currentUserId={currentUserId}
          onClose={() => setEditing(undefined)}
          onSaved={saved}
        />
      )}
      {portfolioSeller && (
        <PortfolioModal
          seller={portfolioSeller}
          clients={clientes}
          nameOf={nameOf}
          reload={async () => {
            const data = await carregar();
            return (data?.usuarios || []).filter((user) => user.tipo === "cliente")
              .sort((a, b) => getClientName(a).localeCompare(getClientName(b), "pt-BR"));
          }}
          onClose={() => setPortfolioSeller(null)}
          onSaved={async (message) => {
            setPortfolioSeller(null);
            await carregar();
            toast.success(message);
          }}
        />
      )}
    </>
  );
}

export default AdminUsuarios;
