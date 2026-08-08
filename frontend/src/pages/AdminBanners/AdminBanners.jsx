import { useEffect, useState } from "react";
import api from "../../api/axios";
import AudienceSelector from "../../components/AudienceSelector/AudienceSelector";
import ImageUploadField from "../../components/ImageUploadField/ImageUploadField";
import {
  FilterToolbar,
  PaginationControls,
} from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import { buildImageFormData } from "../../utils/imageUpload";
import styles from "./AdminBanners.module.css";

const emptyForm = {
  tituloInterno: "",
  link: "",
  ativo: true,
  ordem: "0",
  dataInicial: "",
  dataFinal: "",
  audienciaTipo: "todos",
  distribuidoresIds: [],
};

const toLocalDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

const createForm = (banner) => banner ? {
  tituloInterno: banner.tituloInterno || "",
  link: banner.link || "",
  ativo: banner.ativo !== false,
  ordem: String(banner.ordem ?? 0),
  dataInicial: toLocalDateTime(banner.dataInicial),
  dataFinal: toLocalDateTime(banner.dataFinal),
  audienciaTipo: banner.audienciaTipo || "todos",
  distribuidoresIds: Array.isArray(banner.distribuidoresIds)
    ? banner.distribuidoresIds.map((item) => item?._id || item)
    : [],
} : { ...emptyForm, distribuidoresIds: [] };

const formatDateRange = (banner) => {
  const start = banner.dataInicial
    ? new Date(banner.dataInicial).toLocaleDateString("pt-BR")
    : "início imediato";
  const end = banner.dataFinal
    ? new Date(banner.dataFinal).toLocaleDateString("pt-BR")
    : "sem término";
  return `${start} até ${end}`;
};

function BannerForm({ banner, onClose, onSaved }) {
  const [form, setForm] = useState(() => createForm(banner));
  const [image, setImage] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  const updateField = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const localErrors = {};
    if (!form.tituloInterno.trim()) localErrors.tituloInterno = "Informe o título interno";
    if (!banner && !image) localErrors.imagem = "Selecione a imagem do banner";
    if (banner && removeImage && !image) localErrors.imagem = "Selecione uma nova imagem";
    if (!Number.isInteger(Number(form.ordem))) localErrors.ordem = "Informe um número inteiro";
    if (form.dataInicial && form.dataFinal && form.dataInicial > form.dataFinal) {
      localErrors.dataFinal = "A data final deve ser posterior à inicial";
    }
    if (form.audienciaTipo === "especificos" && form.distribuidoresIds.length === 0) {
      localErrors.distribuidoresIds = "Selecione ao menos um distribuidor";
    }
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    const payload = {
      tituloInterno: form.tituloInterno,
      link: form.link,
      ativo: form.ativo,
      ordem: Number(form.ordem),
      dataInicial: form.dataInicial,
      dataFinal: form.dataFinal,
      audienciaTipo: form.audienciaTipo,
      distribuidoresIds: JSON.stringify(form.distribuidoresIds),
    };
    const requestBody = buildImageFormData(payload, {
      file: image,
      fileField: "imagem",
      remove: removeImage,
      removeField: "removerImagem",
    });

    setSubmitting(true);
    setErrors({});
    try {
      if (banner) await api.put(`/marketing/banners/${banner._id}`, requestBody);
      else await api.post("/marketing/banners", requestBody);
      onSaved(banner ? "Banner atualizado com sucesso" : "Banner criado com sucesso");
    } catch (requestError) {
      setErrors(requestError.response?.data?.errors || {
        formulario: requestError.response?.data?.message || "Não foi possível salvar o banner",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onMouseDown={submitting ? undefined : onClose}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="banner-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div><span>Comunicação visual</span><h2 id="banner-title">{banner ? "Editar banner" : "Novo banner"}</h2></div>
          <button type="button" onClick={onClose} disabled={submitting}>Fechar</button>
        </header>

        <form className={styles.form} onSubmit={submit} noValidate>
          {errors.formulario && <div className={styles.formError} role="alert">{errors.formulario}</div>}

          <div className={styles.fullField}>
            <label htmlFor="tituloInterno">Título interno *</label>
            <input id="tituloInterno" name="tituloInterno" value={form.tituloInterno} onChange={updateField} maxLength={150} autoFocus required />
            {errors.tituloInterno && <small>{errors.tituloInterno}</small>}
          </div>

          <div className={styles.fullField}>
            <label htmlFor="link">Link opcional</label>
            <input id="link" name="link" type="url" inputMode="url" value={form.link} onChange={updateField} maxLength={2048} placeholder="https://..." />
            {errors.link && <small>{errors.link}</small>}
          </div>

          <ImageUploadField
            name="imagem"
            label="Imagem do banner *"
            file={image}
            currentUrl={banner?.imagemUrl || ""}
            removed={removeImage}
            onFileChange={setImage}
            onRemoveChange={setRemoveImage}
            error={errors.imagem}
          />

          <div>
            <label htmlFor="ordem">Ordem</label>
            <input id="ordem" name="ordem" type="number" min="-100000" max="100000" step="1" value={form.ordem} onChange={updateField} />
            {errors.ordem && <small>{errors.ordem}</small>}
          </div>

          <div>
            <label htmlFor="dataInicial">Data inicial</label>
            <input id="dataInicial" name="dataInicial" type="datetime-local" value={form.dataInicial} onChange={updateField} />
            {errors.dataInicial && <small>{errors.dataInicial}</small>}
          </div>

          <div>
            <label htmlFor="dataFinal">Data final</label>
            <input id="dataFinal" name="dataFinal" type="datetime-local" value={form.dataFinal} onChange={updateField} />
            {errors.dataFinal && <small>{errors.dataFinal}</small>}
          </div>

          <div className={styles.statusField}>
            <label><input type="checkbox" name="ativo" checked={form.ativo} onChange={updateField} /> Banner ativo</label>
          </div>

          <div className={styles.fullField}>
            <AudienceSelector
              audienceType={form.audienciaTipo}
              selectedIds={form.distribuidoresIds}
              error={errors.distribuidoresIds || errors.audienciaTipo}
              onChange={({ audienceType, selectedIds }) => {
                setForm((current) => ({ ...current, audienciaTipo: audienceType, distribuidoresIds: selectedIds }));
                setErrors((current) => ({ ...current, audienciaTipo: undefined, distribuidoresIds: undefined }));
              }}
            />
          </div>

          <footer className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className={styles.primaryButton} disabled={submitting}>{submitting ? "Salvando..." : "Salvar banner"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function AdminBanners() {
  const [banners, setBanners] = useState([]);
  const [filters, setFilters] = useState({ busca: "", ativo: "" });
  const [appliedFilters, setAppliedFilters] = useState({ busca: "", ativo: "" });
  const [pagination, setPagination] = useState({ paginaAtual: 1, totalPaginas: 0, totalItens: 0 });
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [modalBanner, setModalBanner] = useState(undefined);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await api.get("/marketing/banners", {
          params: { ...appliedFilters, pagina: page, limite: 12 },
          signal: controller.signal,
        });
        setBanners(Array.isArray(response.data?.banners) ? response.data.banners : []);
        setPagination(response.data?.paginacao || { paginaAtual: page, totalPaginas: 0, totalItens: 0 });
      } catch (requestError) {
        if (requestError.code !== "ERR_CANCELED") {
          setError(requestError.response?.data?.message || "Não foi possível carregar os banners");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [appliedFilters, page, refreshKey]);

  const completeForm = (message) => {
    setModalBanner(undefined);
    setFeedback({ type: "success", message });
    setRefreshKey((value) => value + 1);
  };

  const changeStatus = async (banner) => {
    setBusyId(banner._id);
    try {
      const response = await api.patch(`/marketing/banners/${banner._id}/status`, { ativo: !banner.ativo });
      setFeedback({ type: "success", message: response.data.message });
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.response?.data?.message || "Não foi possível alterar o status" });
    } finally {
      setBusyId("");
    }
  };

  const remove = async (banner) => {
    if (!window.confirm(`Excluir definitivamente o banner "${banner.tituloInterno}"?`)) return;
    setBusyId(banner._id);
    try {
      const response = await api.delete(`/marketing/banners/${banner._id}`);
      setFeedback({ type: "success", message: response.data.message });
      setPage((current) => banners.length === 1 && current > 1 ? current - 1 : current);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setFeedback({ type: "error", message: requestError.response?.data?.message || "Não foi possível excluir o banner" });
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <div><span>Comunicação visual</span><h1>Banners</h1><p>Gerencie os destaques exibidos na área dos distribuidores.</p></div>
          <button type="button" className={styles.primaryButton} onClick={() => setModalBanner(null)}>Novo banner</button>
        </header>

        {feedback && <div className={feedback.type === "success" ? styles.successFeedback : styles.errorFeedback} role="status">{feedback.message}</div>}

        <FilterToolbar
          activeFilterCount={appliedFilters.ativo ? 1 : 0}
          searchLabel="Buscar banners"
          searchPlaceholder="Buscar por título interno..."
          searchValue={filters.busca}
          onSearchChange={(event) => setFilters({ ...filters, busca: event.target.value })}
          onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedFilters({ ...filters }); }}
          onClear={() => { setFilters({ busca: "", ativo: "" }); setAppliedFilters({ busca: "", ativo: "" }); setPage(1); }}
        >
          <select aria-label="Filtrar por status" value={filters.ativo} onChange={(event) => setFilters({ ...filters, ativo: event.target.value })}>
            <option value="">Todos os status</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
        </FilterToolbar>

        <div className={styles.listHeader}><strong>{pagination.totalItens || 0} banners</strong><span>Página {pagination.paginaAtual || page} de {Math.max(pagination.totalPaginas || 0, 1)}</span></div>

        {loading ? (
          <div className={styles.grid}>{[1, 2, 3].map((item) => <div className={styles.skeleton} key={item} />)}</div>
        ) : error ? (
          <div className={styles.stateBox} role="alert">{error}</div>
        ) : banners.length === 0 ? (
          <div className={styles.stateBox}><h2>Nenhum banner encontrado</h2><p>Cadastre um banner ou ajuste os filtros.</p></div>
        ) : (
          <section className={styles.grid} aria-label="Banners cadastrados">
            {banners.map((banner) => (
              <article className={styles.card} key={banner._id}>
                <div className={styles.image}><img src={banner.imagemUrl} alt="" loading="lazy" decoding="async" /></div>
                <div className={styles.cardBody}>
                  <div className={styles.badges}><span>{banner.ativo ? "Ativo" : "Inativo"}</span><span>{banner.audienciaTipo === "especificos" ? "Público específico" : "Todos"}</span></div>
                  <h2>{banner.tituloInterno}</h2>
                  <p>{formatDateRange(banner)}</p>
                  <small>Ordem {banner.ordem ?? 0}</small>
                </div>
                <footer className={styles.cardActions}>
                  <button type="button" onClick={() => setModalBanner(banner)}>Editar</button>
                  <button type="button" disabled={busyId === banner._id} onClick={() => changeStatus(banner)}>{banner.ativo ? "Desativar" : "Ativar"}</button>
                  <button type="button" className={styles.deleteButton} disabled={busyId === banner._id} onClick={() => remove(banner)}>Excluir</button>
                </footer>
              </article>
            ))}
          </section>
        )}

        <PaginationControls currentPage={page} totalPages={pagination.totalPaginas || 0} disabled={loading} onPrevious={() => setPage((value) => value - 1)} onNext={() => setPage((value) => value + 1)} />
      </main>

      {modalBanner !== undefined && <BannerForm banner={modalBanner} onClose={() => setModalBanner(undefined)} onSaved={completeForm} />}
    </>
  );
}

export default AdminBanners;
