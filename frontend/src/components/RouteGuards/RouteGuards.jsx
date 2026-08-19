import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api from "../../api/axios";
import { clearAuthSession, getAuthSession } from "../../utils/authSession";

const roleHome = {
  admin: "/admin",
  comercial: "/precos",
  marketing: "/marketing",
  logistica: "/logistica",
  cliente: "/catalogo",
  groomer: "/groomer",
};

const validationEndpoint = {
  admin: "/produtos",
  comercial: "/tabelas",
  marketing: "/marketing/dashboard",
  logistica: "/logistica/dashboard",
  cliente: "/pedidos/meus",
  groomer: "/treinamentos?limite=1",
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

  return <Navigate to={roleHome[session.usuario.tipo] || "/login"} replace />;
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
        !allowedRolesKey.split(",").includes(currentSession.usuario.tipo)
      ) {
        return;
      }

      setValidation({ key: validationKey, isAllowed: null });

      try {
        await api.get(validationEndpoint[currentSession.usuario.tipo]);

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

  if (!allowedRoles.includes(session.usuario.tipo)) {
    return (
      <Navigate
        to={roleHome[session.usuario.tipo] || "/login"}
        replace
      />
    );
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
