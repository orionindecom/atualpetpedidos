import { useEffect, useId, useState } from "react";
import styles from "./ListControls.module.css";

export function FilterToolbar({
  activeFilterCount = 0,
  children,
  layout = "inline",
  onClear,
  onSearchChange,
  onSubmit,
  searchLabel,
  searchPlaceholder,
  searchValue,
  submitLabel = "Aplicar filtros",
}) {
  const generatedId = useId().replaceAll(":", "");
  const controlsId = `list-filters-${generatedId}`;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasFilters = Boolean(children);

  useEffect(() => {
    if (!filtersOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [filtersOpen]);

  const submit = (event) => {
    onSubmit?.(event);
    if (!onSubmit) event.preventDefault();
    setFiltersOpen(false);
  };

  const clear = () => {
    onClear?.();
    setFiltersOpen(false);
  };

  return (
    <form
      className={styles.toolbar}
      data-layout={layout}
      onSubmit={submit}
      role="search"
      aria-label={searchLabel}
    >
      <div className={styles.searchRow}>
        <label className={styles.searchBox}>
          <span className={styles.srOnly}>{searchLabel}</span>
          <input
            type="search"
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={onSearchChange}
          />
          <button type="submit" className={styles.primaryButton}>
            Buscar
          </button>
        </label>

        {hasFilters ? (
          <button
            type="button"
            className={styles.filterToggle}
            aria-expanded={filtersOpen}
            aria-controls={controlsId}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            Filtros{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        ) : (
          onClear && (
            <button type="button" className={styles.ghostButton} onClick={clear}>
              Limpar
            </button>
          )
        )}
      </div>

      {hasFilters && (
        <div
          id={controlsId}
          className={styles.filterControls}
          data-open={filtersOpen}
        >
          <div className={styles.filterFields}>{children}</div>
          <div className={styles.filterActions}>
            <button type="submit" className={styles.secondaryButton}>
              {submitLabel}
            </button>
            <button type="button" className={styles.ghostButton} onClick={clear}>
              Limpar
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

export function PaginationControls({
  currentPage,
  disabled = false,
  onNext,
  onPrevious,
  totalPages,
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className={styles.pagination} aria-label="Paginação">
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={disabled || currentPage <= 1}
        onClick={onPrevious}
      >
        Anterior
      </button>
      <span>{currentPage} / {totalPages}</span>
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={disabled || currentPage >= totalPages}
        onClick={onNext}
      >
        Próxima
      </button>
    </nav>
  );
}

export function LoadMoreButton({
  disabled = false,
  loading = false,
  onClick,
}) {
  return (
    <div className={styles.loadMore}>
      <button
        type="button"
        className={styles.primaryButton}
        disabled={disabled || loading}
        onClick={onClick}
      >
        {loading ? "Carregando..." : "Mostrar mais"}
      </button>
    </div>
  );
}
