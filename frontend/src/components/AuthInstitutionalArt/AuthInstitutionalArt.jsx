import centralComercialArt from "../../assets/auth/central-comercial-auth.jpeg";
import styles from "./AuthInstitutionalArt.module.css";

function AuthInstitutionalArt() {
  return (
    <section className={styles.panel}>
      <img
        className={styles.image}
        src={centralComercialArt}
        alt="Central Comercial Atual Pet"
      />
    </section>
  );
}

export default AuthInstitutionalArt;
