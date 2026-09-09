import { motion } from 'framer-motion';
import { TrendingUp, Zap, Shield, BarChart3 } from 'lucide-react';

export default function LandingPage() {
  const handleLogin = () => {
  window.location.href =
    'https://digithackertool-backend.onrender.com/api/auth/deriv';
};

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 text-white">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-4xl mx-auto"
        >
          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Digit Hacker Tool
          </h1>
          <p className="text-xl md:text-2xl text-gray-300 mb-8">
            Automated Digit Analysis for Deriv Trading
          </p>
          <p className="text-gray-400 mb-12 max-w-2xl mx-auto">
            Access AI-powered digit analysis for Deriv volatility indices.
            <br />
            Login securely via Deriv OAuth.
          </p>
          
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleLogin}
            className="bg-gradient-to-r from-blue-500 to-purple-600 px-8 py-4 rounded-full text-lg font-semibold shadow-2xl hover:shadow-purple-500/50 transition-all"
          >
            Login with Deriv
          </motion.button>
        </motion.div>

        {/* Features */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mt-20">
          {[
            {
              icon: <Zap className="w-8 h-8" />,
              title: "Automated Scanning",
              text: "Continuously analyzes digit patterns across volatility indices."
            },
            {
              icon: <TrendingUp className="w-8 h-8" />,
              title: "Real-time Signals",
              text: "Get instant Even/Odd, Digit Match, and Over/Under predictions."
            },
            {
              icon: <BarChart3 className="w-8 h-8" />,
              title: "AI Confidence Logic",
              text: "Signals backed by historical probability analysis."
            },
            {
              icon: <Shield className="w-8 h-8" />,
              title: "Secure OAuth",
              text: "Safe integration with your Deriv account via official OAuth."
            }
          ].map((feature, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-white/5 backdrop-blur-xl p-6 rounded-2xl border border-white/10"
            >
              <div className="text-blue-400 mb-4">{feature.icon}</div>
              <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
              <p className="text-gray-400 text-sm">{feature.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
