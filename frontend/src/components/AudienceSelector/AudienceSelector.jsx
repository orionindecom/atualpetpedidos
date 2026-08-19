import { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import styles from "./AudienceSelector.module.css";

const distributorLabel = (distributor) =>
  distributor.nomeFantasia ||
  distributor.razaoSocial ||
  distributor.nomeResponsavel ||
  "Distribuidor";

function AudienceSelector({
  audienceType,
  error,
  onChange,
  onPublicosChange,
  publicos,
  selectedIds,
}) {
  const [distributors, setDistributors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const supportsProfiles = Array.isArray(publicos) && typeof onPublicosChange === "function";
  const includesDistributors = !supportsProfiles || publicos.includes("cliente");

  useEffect(() => {
    if (!includesDistributors || audienceType !== "especificos" || distributors.length > 0) return;

    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const response = await api.get("/marketing/distribuidores", {
          signal: controller.signal,
        });
        setDistributors(
          Array.isArray(response.data?.distribuidores)
            ? response.data.distribuidores
            : []
        );
      } catch (requestError) {
        if (requestError.code !== "ERR_CANCELED") {
          setLoadError(
            requestError.response?.data?.message ||
            "Não foi possível carregar os distribuidores"
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [audienceType, distributors.length, includesDistributors]);

  const visibleDistributors = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return distributors;
    return distributors.filter((distributor) =>
      [
        distributor.nomeFantasia,
        distributor.razaoSocial,
        distributor.nomeResponsavel,
      ].some((value) => value?.toLocaleLowerCase("pt-BR").includes(term))
    );
  }, [distributors, search]);

  const setType = (type) => {
    onChange({
      audienceType: type,
      selectedIds: type === "todos" ? [] : selectedIds,
    });
  };

  const toggleDistributor = (id) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id];
    onChange({ audienceType, selectedIds: next });
  };

  const togglePublico = (publico) => {
    const next = publicos.includes(publico)
      ? publicos.filter((item) => item !== publico)
      : [...publicos, publico];
    onPublicosChange(next);
  };

  return (
    <fieldset className={styles.selector}>
      <legend>Audiência</legend>
      {supportsProfiles && (
        <div className={styles.profileSelector}>
          <strong>Perfis com acesso</strong>
          <div>
            <label data-active={publicos.includes("cliente")}>
              <input
                type="checkbox"
                checked={publicos.includes("cliente")}
                onChange={() => togglePublico("cliente")}
              />
              Distribuidores
            </label>
            <label data-active={publicos.includes("groomer")}>
              <input
                type="checkbox"
                checked={publicos.includes("groomer")}
                onChange={() => togglePublico("groomer")}
              />
              Groomers
            </label>
          </div>
        </div>
      )}

      {includesDistributors && <div className={styles.segmented}>
        <label data-active={audienceType === "todos"}>
          <input
            type="radio"
            name="audienciaTipo"
            value="todos"
            checked={audienceType === "todos"}
            onChange={() => setType("todos")}
          />
          Todos os distribuidores
        </label>
        <label data-active={audienceType === "especificos"}>
          <input
            type="radio"
            name="audienciaTipo"
            value="especificos"
            checked={audienceType === "especificos"}
            onChange={() => setType("especificos")}
          />
          Distribuidores específicos
        </label>
      </div>}

      {includesDistributors && audienceType === "especificos" && (
        <div className={styles.distributorPanel}>
          <div className={styles.selectionHeader}>
            <label htmlFor="audience-search">Selecionar distribuidores</label>
            <span>{selectedIds.length} selecionados</span>
          </div>
          <input
            id="audience-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por empresa ou responsável"
          />

          {loading ? (
            <p className={styles.message}>Carregando distribuidores...</p>
          ) : loadError ? (
            <p className={styles.error} role="alert">{loadError}</p>
          ) : visibleDistributors.length === 0 ? (
            <p className={styles.message}>Nenhum distribuidor encontrado.</p>
          ) : (
            <div className={styles.distributorList}>
              {visibleDistributors.map((distributor) => (
                <label key={distributor._id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(distributor._id)}
                    onChange={() => toggleDistributor(distributor._id)}
                  />
                  <span>
                    <strong>{distributorLabel(distributor)}</strong>
                    {distributor.nomeResponsavel && (
                      <small>{distributor.nomeResponsavel}</small>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <small className={styles.error} role="alert">{error}</small>}
    </fieldset>
  );
}

export default AudienceSelector;
