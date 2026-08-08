import { useEffect, useState } from "react";
import api from "../../api/axios";
import { openMaterialLink } from "../../utils/materialMarketing";
import styles from "./DistributorBanners.module.css";

function DistributorBanners() {
  const [banners, setBanners] = useState([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await api.get("/banners", { signal: controller.signal });
        setBanners(Array.isArray(response.data?.banners) ? response.data.banners : []);
      } catch (error) {
        if (error.code !== "ERR_CANCELED") {
          console.error("Falha ao carregar banners", { status: error.response?.status });
        }
      }
    };
    load();
    return () => controller.abort();
  }, []);

  if (banners.length === 0) return null;

  return (
    <section className={styles.banners} aria-label="Destaques AtualPet">
      {banners.map((banner) => {
        const content = (
          <img
            src={banner.imagemUrl}
            alt="Destaque AtualPet"
            loading="eager"
            decoding="async"
          />
        );

        return banner.link ? (
          <button
            type="button"
            className={styles.banner}
            key={banner._id}
            onClick={() => openMaterialLink(banner.link)}
            aria-label="Abrir destaque"
          >
            {content}
          </button>
        ) : (
          <div className={styles.banner} key={banner._id}>{content}</div>
        );
      })}
    </section>
  );
}

export default DistributorBanners;
