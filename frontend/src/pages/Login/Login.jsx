import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import styles from "./Login.module.css";
import logo from "../../assets/logo-atualpet-white.png";

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

      if (response.data.usuario.tipo === "admin") {
        navigate("/admin");
      } else {
        navigate("/catalogo");
      }
    } catch (error) {
      alert(error.response?.data?.message || "Erro ao realizar login");
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.brand}>
            <div className={styles.logo}>
                  <img src={logo} alt="AtualPet" />
                </div>

          <div>
            <h1>AtualPet</h1>
            <p>Portal Comercial</p>
          </div>
        </div>

        <div className={styles.heroText}>
          <h2>Pedidos mais rápidos, organizados e seguros.</h2>
          <p>
            Acesse sua tabela personalizada, monte pedidos e gere PDFs
            comerciais sem depender de mensagens soltas no WhatsApp.
          </p>
        </div>

        <div className={styles.features}>
          <span>Catálogo por cliente</span>
          <span>PDF automático</span>
          <span>Tabelas personalizadas</span>
        </div>
      </section>

      <section className={styles.loginArea}>
        <div className={styles.mobileIntro}>
          <img src={logo} alt="AtualPet" />
          <strong>AtualPet</strong>
          <span>Portal Comercial</span>
        </div>

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

            <button type="submit">Entrar no portal</button>
          </form>

          <div className={styles.footer}>
            <span>Ainda não tem acesso?</span>
            <span className={styles.mobileFooterText}>
              Ainda não possui cadastro?
            </span>
            <Link to="/cadastro">Solicitar cadastro</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Login;
