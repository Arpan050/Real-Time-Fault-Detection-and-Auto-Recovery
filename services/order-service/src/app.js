'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const logger = require('./config/logger');
const healthRoutes = require('./routes/healthRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const orderRoutes = require('./routes/orderRoutes');
const chaosRoutes = require('./routes/chaosRoutes');
const { requestDurationMiddleware, activeConnectionsMiddleware } = require('./middleware/metricsMiddleware');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(helmet());
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use(express.json({ limit: '10mb' }));
app.use(activeConnectionsMiddleware);
app.use(requestDurationMiddleware);
app.use(requestLogger);

app.use('/health', healthRoutes);
app.use('/metrics', metricsRoutes);
app.use('/api/orders', orderRoutes);
app.use('/chaos', chaosRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
