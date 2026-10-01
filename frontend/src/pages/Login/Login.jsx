import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import styles from "./Login.module.css";
import logo from "../../assets/logo-atualpet-white.png";
import AuthMascots from "../../components/AuthMascots/AuthMascots";
import mascotStyles from "../../components/AuthMascots/AuthMascots.module.css";
import AuthInstitutionalArt from "../../components/AuthInstitutionalArt/AuthInstitutionalArt";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import { classifyLoginError } from "../../utils/accessFeedback";

function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [erroLogin, setErroLogin] = useState("");
  const { dialog } = useFeedback();

  const navigate = useNavigate();

  const fazerLogin = async (e) => {
    e.preventDefault();
    if (entrando) return;
    setErroLogin("");
    setEntrando(true);

    try {
      const response = await api.post("/auth/login", {
        email,
        senha,
      });

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("usuario", JSON.stringify(response.data.usuario));

      const homeByRole = {
        admin: "/admin",
        comercial: "/vendas",
        vendedor: "/vendas",
        marketing: "/marketing",
        logistica: "/logistica",
        cliente: "/conta",
        groomer: "/groomer",
      };
      navigate(homeByRole[response.data.usuario.tipo] || "/login");
    } catch (error) {
      setEntrando(false);
      const acesso = classifyLoginError(error);
      if (acesso.dialog) {
        dialog.alert(acesso.dialog);
        return;
      }
      setErroLogin(acesso.message);
    }
  };

  return (
    <div className={styles.page}>
      <AuthInstitutionalArt />

      <section className={styles.loginArea}>
        <div className={styles.mobileIntro}>
          <img src={logo} alt="AtualPet" />
          <strong>AtualPet</strong>
          <span>Central Comercial</span>
        </div>

        <div className={`${mascotStyles.visual} ${styles.formVisual}`}>
          <AuthMascots />

          <div className={styles.card}>
            <div className={styles.mobileCardHeader}>
              <h1>Bem-vindo 👋</h1>
              <p>Acesse sua conta para continuar.</p>
            </div>

            <h2>Entrar</h2>
            <p>Acesse sua conta para continuar.</p>

            <form className={styles.form} onSubmit={fazerLogin}>
              <label>
                E-mail
                <input
                  type="email"
                  placeholder="seuemail@empresa.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErroLogin(""); }}
                  required
                />
              </label>

              <label>
                Senha
                <input
                  type="password"
                  placeholder="Digite sua senha"
                  value={senha}
                  onChange={(e) => { setSenha(e.target.value); setErroLogin(""); }}
                  required
                />
              </label>

              {erroLogin && <p className={styles.formError} role="alert">{erroLogin}</p>}

              <button type="submit" disabled={entrando}>{entrando ? "Entrando..." : "Entrar na Central"}</button>
            </form>

            <div className={styles.footer}>
              <span>Ainda não tem acesso?</span>
              <span className={styles.mobileFooterText}>
                Ainda não possui cadastro?
              </span>
              <Link to="/cadastro">Solicitar cadastro</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Login;
