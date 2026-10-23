import { authorizeUpload, serveUpload } from '../uploadStorage';
import express from 'express';
import { forwardAsyncRouteErrors } from '../asyncRoutes';
export function createUploadsRouter() {
  const app = express.Router();
  forwardAsyncRouteErrors(app);

app.use("/uploads", (req: express.Request, res: express.Response, next: express.NextFunction) => { authorizeUpload(req, res, next).catch(next); },
  (req: express.Request, res: express.Response, next: express.NextFunction) => { serveUpload(req, res, next).catch(next); });
  return app;
}
