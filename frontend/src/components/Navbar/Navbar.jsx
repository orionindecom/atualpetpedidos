import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import styles from "./Navbar.module.css";
import logo from "../../assets/logo-atualpet.png";

function Navbar() {
  const navigate = useNavigate();
  const [menuAberto, setMenuAberto] = useState(false);

  const usuario = JSON.parse(
    localStorage.getItem("usuario")
  );

  const isAdmin = usuario?.tipo === "admin";

  useEffect(() => {
    document.body.classList.toggle("admin-layout", isAdmin);

    return () => {
      document.body.classList.remove("admin-layout");
    };
  }, [isAdmin]);

  const sair = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");

    navigate("/login");
  };

  const linkClass = ({ isActive }) =>
    `${styles.link} ${isActive ? styles.active : ""}`;

  const adminLinks = [
    { to: "/admin", label: "Dashboard", group: "Visão geral" },
    { to: "/produtos", label: "Produtos", group: "Catálogo" },
    { to: "/tabelas", label: "Tabelas", group: "Comercial" },
    { to: "/precos", label: "Preços", group: "Comercial" },
    { to: "/clientes", label: "Clientes", group: "Relacionamento" },
    { to: "/pedidos", label: "Pedidos", group: "Operação" },
    {
      to: "/admin/materiais-marketing",
      label: "Materiais de Marketing",
      group: "Conteúdo",
    },
  ];

  const clienteLinks = [
    { to: "/catalogo", label: "Catálogo" },
    { to: "/precos-cliente-final", label: "Preços Cliente Final" },
    { to: "/materiais-marketing", label: "Materiais de Marketing" },
    { to: "/meus-pedidos", label: "Meus Pedidos" },
  ];

  const fecharMenu = () => setMenuAberto(false);

  return (
    <>
      <header className={`${styles.navbar} ${isAdmin ? styles.admin : ""}`}>
        <div className={styles.brand}>
          <img src={logo} alt="AtualPet" />
          <div>
            <strong>AtualPet</strong>
            <span>{isAdmin ? "Administração" : "Área do cliente"}</span>
          </div>
        </div>

        <button
          type="button"
          className={styles.menuButton}
          onClick={() => setMenuAberto((aberto) => !aberto)}
          aria-label="Abrir menu"
          aria-expanded={menuAberto}
        >
          <span />
          <span />
          <span />
        </button>

        <nav className={styles.links}>
          {isAdmin
            ? adminLinks.map((link, index) => (
                <div className={styles.navGroup} key={link.to}>
                  {(index === 0 ||
                    adminLinks[index - 1].group !== link.group) && (
                    <span>{link.group}</span>
                  )}
                  <NavLink to={link.to} className={linkClass}>
                    {link.label}
                  </NavLink>
                </div>
              ))
            : clienteLinks.map((link) => (
                <NavLink key={link.to} to={link.to} className={linkClass}>
                  {link.label}
                </NavLink>
              ))}
        </nav>

        <div className={styles.usuario}>
          <span>{usuario?.nomeResponsavel}</span>
          <button onClick={sair}>Sair</button>
        </div>
      </header>

      {menuAberto && (
        <div className={styles.mobileOverlay} onClick={fecharMenu}>
          <nav
            className={styles.mobileMenu}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.mobileHeader}>
              <img src={logo} alt="AtualPet" />
              <button type="button" onClick={fecharMenu}>
                Fechar
              </button>
            </div>

            {(isAdmin ? adminLinks : clienteLinks).map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={linkClass}
                onClick={fecharMenu}
              >
                {link.label}
              </NavLink>
            ))}

            <button className={styles.sairMobile} onClick={sair}>
              Sair
            </button>
          </nav>
        </div>
      )}
    </>
  );
}

export default Navbar;
