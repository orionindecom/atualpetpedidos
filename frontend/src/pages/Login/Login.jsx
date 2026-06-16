import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import styles from "./Login.module.css";

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
      localStorage.setItem(
        "usuario",
        JSON.stringify(response.data.usuario)
      );

      if (response.data.usuario.tipo === "admin") {
        navigate("/clientes");
      } else {
        navigate("/catalogo");
      }
    } catch (error) {
      alert(
        error.response?.data?.message ||
          "Erro ao realizar login"
      );
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <h1>AtualPet</h1>
          <p>Portal Comercial</p>
        </div>

        <form
          className={styles.form}
          onSubmit={fazerLogin}
        >
          <input
            className={styles.input}
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
          />

          <input
            className={styles.input}
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) =>
              setSenha(e.target.value)
            }
          />

          <button
            className={styles.botao}
            type="submit"
          >
            Entrar
          </button>
        </form>

        <div className={styles.links}>
          <Link to="/cadastro">
            Solicitar cadastro
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Login;