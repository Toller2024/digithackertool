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
import historicalRoutes from './routes/historical.js';

dotenv.config();

const app = express();

/*
 * Trust Render's reverse proxy.
 */
app.set('trust proxy', 1);

/*
 * Connect MongoDB.
 */
await connectDB();

/*
 * Allowed frontend origins.
 */
const allowedOrigins = [
  'https://digitalhackertool.vercel.app',
  'https://www.digitalhackertool.vercel.app'
];

/*
 * CORS
 */
app.use(
  cors({
    origin: function (origin, callback) {
      /*
       * Allow requests without an Origin header.
       * This is useful for server-to-server requests
       * and health checks.
       */
      if (!origin) {
        return callback(null, true);
      }

      if (
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      console.error(
        '❌ CORS BLOCKED:',
        origin
      );

      return callback(
        new Error(
          'Not allowed by CORS'
        )
      );
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With'
    ]
  })
);

/*
 * Helmet
 *
 * Configured to allow the Vercel frontend
 * to communicate with Render, including SSE.
 */
app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin'
    },

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        connectSrc: [
          "'self'",
          'https://digitalhackertool.vercel.app',
          'https://www.digitalhackertool.vercel.app',
          'https://digithackertool-backend.onrender.com',
          'wss://api.derivws.com'
        ],

        imgSrc: [
          "'self'",
          'data:',
          'https:'
        ],

        scriptSrc: [
          "'self'"
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'"
        ]
      }
    }
  })
);

/*
 * Body parsing.
 */
app.use(
  express.json({
    limit: '1mb'
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '1mb'
  })
);

/*
 * Cookies.
 */
app.use(cookieParser());

/*
 * Sessions.
 */
app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      'change-this-session-secret',

    resave: false,

    saveUninitialized: false,

    store:
      process.env.MONGODB_URI
        ? MongoStore.create({
            mongoUrl:
              process.env.MONGODB_URI,

            collectionName:
              'sessions'
          })
        : undefined,

    cookie: {
      httpOnly: true,

      secure: true,

      sameSite: 'none',

      maxAge:
        1000 *
        60 *
        60 *
        24 *
        7
    }
  })
);

/*
 * Basic health endpoint.
 */
app.get(
  '/',
  (req, res) => {
    res.json({
      success: true,
      message:
        'DigiHackerTool backend is running',
      status: 'OK'
    });
  }
);

app.get(
  '/health',
  (req, res) => {
    res.json({
      success: true,
      status: 'OK'
    });
  }
);

/*
 * API routes.
 */
app.use(
  '/api/auth',
  authRoutes
);

app.use(
  '/api/user',
  userRoutes
);

/*
 * Live tick routes.
 *
 * Existing Dashboard SSE uses:
 *
 * /ticks/stream/:symbol
 */
app.use(
  '/ticks',
  tickRoutes
);

/*
 * Historical-memory routes.
 *
 * These are used manually to populate the
 * MongoDB learning database.
 */
app.use(
  '/historical',
  historicalRoutes
);

/*
 * 404 handler.
 */
app.use(
  (req, res) => {
    res.status(404).json({
      success: false,
      error: 'Route not found',
      path: req.originalUrl
    });
  }
);

/*
 * Global error handler.
 */
app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      '❌ GLOBAL SERVER ERROR:',
      error?.message ||
        String(error)
    );

    /*
     * CORS errors.
     */
    if (
      error?.message ===
      'Not allowed by CORS'
    ) {
      return res.status(403).json({
        success: false,
        error:
          'Origin not allowed'
      });
    }

    if (
      res.headersSent
    ) {
      return next(error);
    }

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        'Internal server error'
    });
  }
);

/*
 * Render provides PORT through the environment.
 */
const PORT =
  process.env.PORT || 10000;

/*
 * Start server.
 */
app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');
    console.log(
      '=========================================='
    );
    console.log(
      '🚀 DIGIHACKERTOOL BACKEND'
    );
    console.log(
      '=========================================='
    );
    console.log(
      `PORT: ${PORT}`
    );
    console.log(
      'MongoDB: Connected'
    );
    console.log(
      'Live ticks: ENABLED'
    );
    console.log(
      'Historical memory: ENABLED'
    );
    console.log(
      '=========================================='
    );
    console.log('');
  }
);
