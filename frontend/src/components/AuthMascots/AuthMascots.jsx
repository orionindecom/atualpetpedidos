import styles from "./AuthMascots.module.css";
import jocaFormulario from "../../assets/auth-mascots/joca-formulario.png";
import jocaPes from "../../assets/auth-mascots/joca-pes.png";
import zikiFormulario from "../../assets/auth-mascots/ziki-formulario.png";

function AuthMascots() {
  return (
    <div className={styles.mascots} aria-hidden="true">
      <div className={styles.jocaMascot}>
        <img
          className={`${styles.mascot} ${styles.jocaBehind}`}
          src={jocaFormulario}
          alt=""
        />
        <img
          className={`${styles.mascot} ${styles.jocaGrip}`}
          src={jocaFormulario}
          alt=""
        />
        <img
          className={`${styles.mascot} ${styles.jocaFeet}`}
          src={jocaPes}
          alt=""
        />
      </div>

      <img
        className={`${styles.mascot} ${styles.ziki}`}
        src={zikiFormulario}
        alt=""
      />
    </div>
  );
}

export default AuthMascots;
