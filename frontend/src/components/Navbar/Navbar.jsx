import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import styles from "./Navbar.module.css";
import logo from "../../assets/logo-atualpet-oficial.webp";

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
  { to: "/admin/treinamentos", label: "Treinamentos", group: "Conteúdo" },
];

const clienteLinks = [
  { to: "/catalogo", label: "Catálogo", group: "Comercial" },
  { to: "/meus-pedidos", label: "Meus Pedidos", group: "Comercial" },
  {
    to: "/precos-cliente-final",
    label: "Preços Cliente Final",
    group: "Comercial",
  },
  {
    to: "/materiais-marketing",
    label: "Materiais de Marketing",
    group: "Conteúdo",
  },
  { to: "/treinamentos", label: "Treinamentos", group: "Conteúdo" },
];

function Navbar() {
  const navigate = useNavigate();
  const menuButtonRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [menuAberto, setMenuAberto] = useState(false);

  const usuario = JSON.parse(localStorage.getItem("usuario"));
  const isAdmin = usuario?.tipo === "admin";
  const links = isAdmin ? adminLinks : clienteLinks;
  const home = isAdmin ? "/admin" : "/catalogo";
  const userName = usuario?.nomeResponsavel || usuario?.nomeFantasia || "Minha conta";

  useEffect(() => {
    document.body.classList.toggle("admin-layout", isAdmin);

    return () => {
      document.body.classList.remove("admin-layout");
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!menuAberto) return undefined;

    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMenuAberto(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      menuButton?.focus();
    };
  }, [menuAberto]);

  const sair = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    navigate("/login");
  };

  const linkClass = ({ isActive }) =>
    `${styles.link} ${isActive ? styles.active : ""}`;

  const fecharMenu = () => setMenuAberto(false);

  return (
    <>
      <header className={`${styles.navbar} ${isAdmin ? styles.admin : ""}`}>
        <NavLink to={home} className={styles.brand} aria-label="Ir para o início do portal">
          <img src={logo} alt="Atual Pet" width="110" height="76" />
          <div className={styles.brandCopy}>
            <strong>Portal Comercial</strong>
            <span>{isAdmin ? "Administração" : "Distribuidores"}</span>
          </div>
        </NavLink>

        <button
          ref={menuButtonRef}
          type="button"
          className={styles.menuButton}
          onClick={() => setMenuAberto((aberto) => !aberto)}
          aria-label="Abrir menu"
          aria-expanded={menuAberto}
          aria-controls="portal-mobile-menu"
        >
          <span />
          <span />
          <span />
        </button>

        <nav className={styles.links} aria-label="Navegação principal">
          {links.map((link, index) => (
            <div className={styles.navGroup} key={link.to}>
              {(index === 0 || links[index - 1].group !== link.group) && (
                <span>{link.group}</span>
              )}
              <NavLink to={link.to} className={linkClass}>
                {link.label}
              </NavLink>
            </div>
          ))}
        </nav>

        <div className={styles.usuario}>
          <div>
            <span>{userName}</span>
            <small>{isAdmin ? "Administrador" : "Conta aprovada"}</small>
          </div>
          <button type="button" onClick={sair}>Sair</button>
        </div>
      </header>

      {menuAberto && (
        <div className={styles.mobileOverlay} onMouseDown={fecharMenu}>
          <nav
            id="portal-mobile-menu"
            className={styles.mobileMenu}
            aria-label="Navegação mobile"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.mobileHeader}>
              <img src={logo} alt="Atual Pet" width="104" height="72" />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={fecharMenu}
                aria-label="Fechar menu"
              >
                ×
              </button>
            </div>

            <div className={styles.mobileAccount}>
              <strong>{userName}</strong>
              <span>{isAdmin ? "Administração" : "Portal do distribuidor"}</span>
            </div>

            <div className={styles.mobileLinks}>
              {links.map((link, index) => (
                <div className={styles.mobileNavItem} key={link.to}>
                  {(index === 0 || links[index - 1].group !== link.group) && (
                    <span className={styles.mobileGroupLabel}>{link.group}</span>
                  )}
                  <NavLink to={link.to} className={linkClass} onClick={fecharMenu}>
                    {link.label}
                  </NavLink>
                </div>
              ))}
            </div>

            <button type="button" className={styles.sairMobile} onClick={sair}>
              Sair da conta
            </button>
          </nav>
        </div>
      )}
    </>
  );
}

export default Navbar;
