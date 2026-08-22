import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { setupSocketHandlers } from './socket/handlers.js';
import { startPoller } from './ynab/poller.js';
import transactionsRouter from './routes/transactions.js';
import categoriesRouter from './routes/categories.js';
import accountsRouter from './routes/accounts.js';
import budgetsRouter from './routes/budgets.js';
import rulesRouter from './routes/rules.js';
import agentRouter from './routes/agent.js';
import snapshotsRouter from './routes/snapshots.js';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  },
});

app.use(cors());
app.use(express.json());

app.use('/api/transactions', transactionsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/agent', agentRouter);
app.use('/api/snapshots', snapshotsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

setupSocketHandlers(io);
startPoller(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`YNAB backend running on port ${PORT}`);
});
