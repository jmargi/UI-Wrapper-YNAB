import { triggerPoll, getActiveBudgetId, setActiveBudgetId } from '../ynab/poller.js';

export const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('poll:trigger', async () => {
      await triggerPoll(io);
    });

    socket.on('budget:select', (budgetId) => {
      setActiveBudgetId(budgetId);
      socket.emit('budget:selected', { budgetId });
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
};
