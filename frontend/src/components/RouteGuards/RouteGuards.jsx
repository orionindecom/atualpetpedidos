import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api from "../../api/axios";
import { clearAuthSession, getAuthSession } from "../../utils/authSession";

const roleHome = {
  admin: "/admin",
  cliente: "/catalogo",
};

const validationEndpoint = {
  admin: "/produtos",
  cliente: "/pedidos/meus",
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

export function RoleRoute({ role, children }) {
  const location = useLocation();
  const [isAllowed, setIsAllowed] = useState(null);
  const session = getAuthSession();

  useEffect(() => {
    let isActive = true;

    const validateAccess = async () => {
      const currentSession = getAuthSession();

      if (!currentSession || currentSession.usuario.tipo !== role) {
        if (isActive) {
          setIsAllowed(false);
        }
        return;
      }

      try {
        await api.get(validationEndpoint[role]);

        if (isActive) {
          setIsAllowed(true);
        }
      } catch {
        clearAuthSession();

        if (isActive) {
          setIsAllowed(false);
        }
      }
    };

    validateAccess();

    return () => {
      isActive = false;
    };
  }, [role, location.pathname]);

  if (!session) {
    clearAuthSession();
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (session.usuario.tipo !== role) {
    return (
      <Navigate
        to={roleHome[session.usuario.tipo] || "/login"}
        replace
      />
    );
  }

  if (isAllowed === null) {
    return <AccessChecking />;
  }

  if (!isAllowed) {
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
