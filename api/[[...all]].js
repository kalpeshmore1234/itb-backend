import serverless from 'serverless-http';
import app from '../server.js';  // app will be exported from server.js via serverless

export default serverless(app);
