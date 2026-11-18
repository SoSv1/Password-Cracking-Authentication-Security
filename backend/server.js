import { createServer } from 'node:http';
import { Config } from './config/config.js';
import { AuthService } from './services/authService.js';
import { JwtService } from './services/jwtService.js';
import { HttpRouter } from './httpRouter.js';

class Application {
  async start() {
    const config = new Config();

    const authService = new AuthService(config);
    await authService.initialize(config.adminUsername, config.adminPassword);

    const router = new HttpRouter(config, authService, new JwtService(config));

    const server = createServer({ maxHeaderSize: 16_384, connectionsCheckingInterval: 1000 }, (request, response) => {
      // No per-request attack logging; contain even unexpected response/stream failures.
      request.on('error', () => {});
      response.on('error', () => {});
      void router.handle(request, response).catch(() => response.destroy());
    });

    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 50;

    server.on('error', () => {
      console.error('Unable to start HTTP server. Check HOST and PORT.');
      process.exitCode = 1;
    });

    server.listen(config.port, config.host, () => {
      console.log(`Backend listening on port ${config.port}.`);
    });
  }
}

new Application().start().catch(() => {
  console.error('Startup failed. Check environment values against .env.example and README.md.');
  process.exitCode = 1;
});
