import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import styles from "./Login.module.css";
import logo from "../../assets/logo-atualpet-white.png";
import AuthMascots from "../../components/AuthMascots/AuthMascots";
import mascotStyles from "../../components/AuthMascots/AuthMascots.module.css";
import AuthInstitutionalArt from "../../components/AuthInstitutionalArt/AuthInstitutionalArt";

function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  const navigate = useNavigate();

  const fazerLogin = async (e) => {
    e.preventDefault();

    try {
      const response = await api.post("/auth/login", {
        email,
        senha,
      });

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("usuario", JSON.stringify(response.data.usuario));

      const homeByRole = {
        admin: "/admin",
        comercial: "/precos",
        marketing: "/marketing",
        logistica: "/logistica",
        cliente: "/catalogo",
        groomer: "/groomer",
      };
      navigate(homeByRole[response.data.usuario.tipo] || "/login");
    } catch (error) {
      alert(error.response?.data?.message || "Erro ao realizar login");
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
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label>
                Senha
                <input
                  type="password"
                  placeholder="Digite sua senha"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                />
              </label>

              <button type="submit">Entrar na Central</button>
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
