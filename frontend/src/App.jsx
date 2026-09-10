import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';

const BACKEND_URL =
  'https://digithackertool-backend.onrender.com';

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
          credentials: 'include'
        }
      );

      if (response.ok) {
        const data = await response.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
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
          credentials: 'include'
        }
      );
    } catch (error) {
      console.error('Logout failed:', error);
    }

    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-lg">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>

        <Route
          path="/"
          element={
            user
              ? <Navigate to="/dashboard" replace />
              : <LandingPage />
          }
        />

        <Route
          path="/dashboard"
          element={
            user
              ? (
                <Dashboard
                  user={user}
                  onLogout={handleLogout}
                />
              )
              : <Navigate to="/" replace />
          }
        />

      </Routes>
    </BrowserRouter>
  );
}

export default App;
