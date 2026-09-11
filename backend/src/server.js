import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import dotenv from 'dotenv';

import { connectDB } from './config/database.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import tickRoutes from './routes/ticks.js';

dotenv.config();

const app = express();

app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'https://digitalhackertool.vercel.app',
  'https://www.digitalhackertool.vercel.app'
];

app.use(helmet());

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    if (
      origin.endsWith('.vercel.app') &&
      origin.startsWith('https://')
    ) {
      return callback(null, true);
    }

    if (
      process.env.FRONTEND_URL &&
      origin === process.env.FRONTEND_URL
    ) {
      return callback(null, true);
    }

    return callback(
      new Error('Not allowed by CORS')
    );
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

/*
 * Store sessions in MongoDB.
 * This allows the OAuth session to survive
 * the redirect from Deriv back to the frontend.
 */
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,

  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60
  }),

  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production'
      ? 'none'
      : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/ticks', tickRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Connect to database and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});
