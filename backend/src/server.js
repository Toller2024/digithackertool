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

/*
 * SECURITY HEADERS
 *
 * Allow the Vercel frontend to establish:
 * Vercel -> Render SSE connections.
 */
app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin'
    },

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'"
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https:'
        ],

        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https:'
        ],

        fontSrc: [
          "'self'",
          'data:',
          'https:'
        ],

        connectSrc: [
          "'self'",
          'https://digithackertool-backend.onrender.com',
          'https://digitalhackertool.vercel.app',
          'https://www.digitalhackertool.vercel.app',
          'https://*.vercel.app',
          'wss:',
          'https:'
        ],

        frameSrc: [
          "'self'",
          'https:'
        ],

        objectSrc: ["'none'"],

        baseUri: ["'self'"],

        formAction: [
          "'self'",
          'https:'
        ]
      }
    }
  })
);

/*
 * CORS
 */
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (
        origin.startsWith('https://') &&
        origin.endsWith('.vercel.app')
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
  })
);

/*
 * Body and cookies
 */
app.use(express.json());
app.use(cookieParser());

/*
 * MongoDB session storage
 */
app.use(
  session({
    secret: process.env.SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: 'sessions',
      ttl: 24 * 60 * 60
    }),

    cookie: {
      secure:
        process.env.NODE_ENV === 'production',

      httpOnly: true,

      sameSite:
        process.env.NODE_ENV === 'production'
          ? 'none'
          : 'lax',

      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

/*
 * ROUTES
 */
app.use('/api/auth', authRoutes);

app.use('/user', userRoutes);

app.use('/ticks', tickRoutes);

/*
 * HEALTH CHECK
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

/*
 * START SERVER
 */
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `🚀 Server running on port ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      '❌ Failed to connect to database:',
      error
    );

    process.exit(1);
  });
