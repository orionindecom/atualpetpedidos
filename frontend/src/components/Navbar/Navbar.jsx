import { Link, useNavigate } from "react-router-dom";
import styles from "./Navbar.module.css";

function Navbar() {
  const navigate = useNavigate();

  const usuario = JSON.parse(
    localStorage.getItem("usuario")
  );

  const sair = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");

    navigate("/login");
  };

  return (
    <header className={styles.navbar}>
      <div className={styles.logo}>
        ATUALPET
      </div>

      <nav className={styles.links}>
        {usuario?.tipo === "admin" ? (
          <>
            <Link to="/admin">Dashboard</Link>
            <Link to="/produtos">Produtos</Link>
            <Link to="/clientes">Clientes</Link>
          </>
        ) : (
          <>
            <Link to="/catalogo">Catálogo</Link>
            <Link to="/meus-pedidos">
              Meus Pedidos
            </Link>
          </>
        )}
      </nav>

      <div className={styles.usuario}>
        <span>
          {usuario?.nomeResponsavel}
        </span>

        <button onClick={sair}>
          Sair
        </button>
      </div>
    </header>
  );
}

export default Navbar;