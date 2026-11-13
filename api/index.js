import { createVercelHandler } from '../server/vercel.mjs';

// One application and pool per warm function instance; no listening socket.
export default createVercelHandler();
