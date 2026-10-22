import type express from 'express';

/** Express 4 does not forward rejected route promises to its error middleware. `use` is left alone: wrapping it would hide arity-4 error handlers. */
export function forwardAsyncRouteErrors(app: express.Express | express.Router) {
  const wrap = (handler: any): any => Array.isArray(handler) ? handler.map(wrap) : typeof handler !== 'function' ? handler :
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const result = handler(req,res,next);
      if (result && typeof result.catch === 'function') result.catch(next);
    };
  for (const method of ['get','post','put','patch','delete','all'] as const) {
    const register = (app[method] as Function).bind(app);
    (app as any)[method] = (route: any, ...handlers: any[]) => register(route,...handlers.map(wrap));
  }
}
