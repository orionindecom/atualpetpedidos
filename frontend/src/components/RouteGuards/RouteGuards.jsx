import { canOpenRoute } from "../../utils/permissions";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import api from "../../api/axios";
import { clearAuthSession, getAuthSession } from "../../utils/authSession";

const roleHome = {
  admin: "/admin",
  comercial: "/vendas",
  vendedor: "/vendas",
  marketing: "/marketing",
  logistica: "/logistica",
  cliente: "/conta",
  groomer: "/groomer",
};

function AccessChecking() {
  return null;
}

export function HomeRedirect() {
  const session = getAuthSession();

  if (!session) {
    clearAuthSession();
    return <Navigate to="/login" replace />;
  }

  const home = roleHome[session.usuario.tipo] || '/login';
  const destino = [home, '/carteira', '/pedidos', '/precos', '/treinamentos', '/materiais-marketing', '/usuarios']
    .find((path) => canOpenRoute(session.usuario, path, path === home ? [session.usuario.tipo] : []));
  if (!destino) return <main style={{ padding: 32 }}><h1>Nenhum acesso disponível</h1><p>Solicite ao administrador a revisão das suas permissões.</p><Link to="/login" onClick={clearAuthSession}>Sair</Link></main>;
  return <Navigate to={destino} replace />;
}

export function RoleRoute({ role, roles, children }) {
  const location = useLocation();
  const [validation, setValidation] = useState({
    key: null,
    isAllowed: null,
  });
  const session = getAuthSession();
  const allowedRoles = Array.isArray(roles) ? roles : [role].filter(Boolean);
  const allowedRolesKey = allowedRoles.join(",");
  const validationKey = `${allowedRolesKey}:${location.pathname}:${session?.token || ""}`;

  useEffect(() => {
    let isActive = true;

    const validateAccess = async () => {
      const currentSession = getAuthSession();

      if (
        !currentSession ||
        !canOpenRoute(currentSession.usuario, location.pathname, allowedRolesKey.split(","))
      ) {
        return;
      }

      setValidation({ key: validationKey, isAllowed: null });

      try {
        const { data } = await api.get("/auth/me");
        localStorage.setItem("usuario", JSON.stringify({ ...currentSession.usuario, ...data.usuario }));
        if (!canOpenRoute(data.usuario, location.pathname, allowedRolesKey.split(","))) {
          if (isActive) setValidation({ key: validationKey, isAllowed: false });
          return;
        }

        if (isActive) {
          setValidation({ key: validationKey, isAllowed: true });
        }
      } catch {
        clearAuthSession();

        if (isActive) {
          setValidation({ key: validationKey, isAllowed: false });
        }
      }
    };

    validateAccess();

    return () => {
      isActive = false;
    };
  }, [allowedRolesKey, location.pathname, validationKey]);

  if (!session) {
    clearAuthSession();
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!canOpenRoute(session.usuario, location.pathname, allowedRoles)) {
    return <main style={{ padding: 32 }}><h1>Acesso negado</h1><p>Você não possui permissão para este módulo.</p><Link to="/">Voltar ao início</Link></main>;
  }

  if (validation.key !== validationKey || validation.isAllowed === null) {
    return <AccessChecking />;
  }

  if (!validation.isAllowed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export function NotFoundRoute() {
  const session = getAuthSession();

  if (!session) {
    clearAuthSession();
    return <Navigate to="/login" replace />;
  }

  return (
    <main style={{ padding: "32px", fontFamily: "inherit" }}>
      <h1>Pagina nao encontrada</h1>
      <p>A rota acessada nao existe.</p>
    </main>
  );
}
