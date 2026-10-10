import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SYSTEM_TABS } from '@legalio/shared/systemConsole';

/** The built console is served even when workspace Vite is disabled. */
export function mountSystemConsole(app: express.Express, directory: string) {
  app.get('/app', (req, res, next) => {
    if (typeof req.query.tab !== 'string' || !SYSTEM_TABS.includes(req.query.tab)) return next();
    res.redirect(302, `/sys?tab=${encodeURIComponent(req.query.tab)}`);
  });
  app.get(['/sys', '/sys/'], (_req, res) => {
    const entry = path.join(directory, 'index.html');
    if (!existsSync(entry)) {
      res.status(503).type('text').send('System Console has not been built. Run npm run build:sys.');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(entry);
  });
  app.use('/sys', express.static(directory, { index: false, dotfiles: 'deny' }), (_req, res) => {
    res.status(404).type('text').send('System Console resource not found.');
  });
}
