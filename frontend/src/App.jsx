import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const BACKEND_URL = 'https://digithackertool-backend.onrender.com';

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user || data);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Authentication check failed:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }

    setUser(null);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>

        <Route
          path="/"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <h1>Digi Hacker Tool</h1>
                <p>Login with Deriv to continue.</p>

                <a href={`${BACKEND_URL}/api/auth/deriv`}>
                  <button>Login with Deriv</button>
                </a>
              </div>
            )
          }
        />

        <Route
          path="/dashboard"
          element={
            user ? (
              <Dashboard
                user={user}
                onLogout={handleLogout}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />

      </Routes>
    </BrowserRouter>
  );
}

export default App;
