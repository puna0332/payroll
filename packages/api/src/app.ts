import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import helmetModule from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import routes from './routes/index.js';

/**
 * Express app shared by the local/VPS server and Vercel serverless wrapper.
 */

const app: Express = express();
const helmetMiddleware = helmetModule as unknown as typeof import('helmet').default;

// ─── Middleware ──────────────────────────────────────────────

app.use(helmetMiddleware());
app.use(cors());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ─────────────────────────────────────────────────

app.use('/api', routes);

// ─── 404 Handler ────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Route không tồn tại',
  });
});

// ─── Global Error Handler ───────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);

  const statusCode = 'statusCode' in err ? (err as any).statusCode : 500;

  res.status(statusCode).json({
    status: 'error',
    message:
      env.NODE_ENV === 'production'
        ? 'Lỗi hệ thống — vui lòng thử lại sau'
        : err.message,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

export default app;
