import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';

const BACKEND_URL = 'https://digithackertool-backend.onrender.com';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/auth/me`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();

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
      await fetch(
        `${BACKEND_URL}/api/auth/logout`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Accept': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Logout failed:', error);
    }

    setUser(null);
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>

        {/* HOME */}
        <Route
          path="/"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LandingPage />
            )
          }
        />

        {/* DASHBOARD */}
        <Route
          path="/dashboard"
          element={
            user ? (
              <Dashboard
                user={user}
                onLogout={handleLogout}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />

        {/* ANY UNKNOWN PAGE */}
        <Route
          path="*"
          element={
            <Navigate
              to={user ? "/dashboard" : "/"}
              replace
            />
          }
        />

      </Routes>
    </BrowserRouter>
  );
}

export default App;
